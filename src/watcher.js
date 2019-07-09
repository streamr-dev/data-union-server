const EventEmitter = require("events")

const { Contract, utils } = require("ethers")

const MonoplasmaState = require("monoplasma/src/state")
const { replayOn, mergeEventLists } = require("./utils/events")
const { throwIfSetButNotContract, throwIfBadAddress, throwIfSetButBadAddress } = require("./utils/checkArguments")
const partitionArray = require("./utils/partitionArray")

const TokenJson = require("../build/ERC20Mintable.json")
const MonoplasmaJson = require("../build/Monoplasma.json")

// TODO: this typedef is foobar. How to get the real thing with JSDoc?
/** @typedef {number} BigNumber */

/**
 * MonoplasmaWatcher hooks to the Ethereum root chain contract and Streamr join/part stream
 * It syncs the state from Ethereum and Streamr into the store
 */
module.exports = class MonoplasmaWatcher extends EventEmitter {

    constructor(eth, joinPartChannel, store, logFunc, errorFunc) {
        super()
        this.eth = eth
        this.channel = joinPartChannel
        this.store = store
        this.log = logFunc || (() => {})
        this.error = errorFunc || console.error
        this.messageQueue = []

        this.filters = {}
        this.eventLogIndex = +new Date()
        this.blockTimestampCache = {}
    }

    /**
     * Sync the state into store, start listening to events and messages
     * @param {MonoplasmaConfig} config
     * @returns {Promise} resolves when MonoplasmaState is synced and listeners added
     */
    async start(config) {
        await throwIfSetButNotContract(this.eth, config.contractAddress, "contractAddress from initial config")
        throwIfSetButBadAddress(config.defaultReceiverAddress, "defaultReceiverAddress from initial config")

        this.eth.on("block", blockNumber => {
            if (blockNumber % 10 === 0) { this.log(`Block ${blockNumber} observed`) }
            this.state.lastObservedBlockNumber = blockNumber
        })

        this.log("Initializing Monoplasma state...")
        const savedState = config.reset ? {} : await this.store.loadState()
        this.state = Object.assign({
            lastBlockNumber: 0,
        }, savedState, config)

        throwIfBadAddress(this.state.defaultReceiverAddress, "defaultReceiverAddress")

        // get initial state from contracts, also works as a sanity check for the config
        this.contract = new Contract(this.state.contractAddress, MonoplasmaJson.abi, this.eth)
        this.state.tokenAddress = await this.contract.token()
        this.token = new Contract(this.state.tokenAddress, TokenJson.abi, this.eth)
        this.state.blockFreezeSeconds = (await this.contract.blockFreezeSeconds()).toString()
        this.log(`Read from contracts: freeze period = ${this.state.blockFreezeSeconds} sec, token @ ${this.state.tokenAddress}`)

        const lastBlock = this.state.lastPublishedBlock && await this.store.loadBlock(this.state.lastPublishedBlock)
        let savedMembers = []
        if (lastBlock) {
            this.log(`Loaded state with ${savedMembers.length} members`)
            savedMembers = lastBlock.members
        }
        this.plasma = new MonoplasmaState(this.state.blockFreezeSeconds, savedMembers, this.store, this.state.defaultReceiverAddress)

        this.log("Syncing Monoplasma state...")
        const playbackStartingTimestamp = this.state.lastMessageTimestamp || 0
        const playbackStartingBlock = this.state.blockNumber || 0

        // TODO: move the transferEvents getLogs to playbackUntil
        this.log(`Retrieving events starting from block ${playbackStartingBlock}...`)
        const blockCreateFilter = this.contract.filters.BlockCreated()
        const tokenTransferFilter = this.token.filters.Transfer(null, this.contract.address)
        blockCreateFilter.fromBlock = tokenTransferFilter.fromBlock = playbackStartingBlock
        const blockCreateEvents = await this.eth.getLogs(blockCreateFilter)
        const transferEvents = await this.eth.getLogs(tokenTransferFilter)
        this.eventQueue = mergeEventLists(blockCreateEvents, transferEvents)
        this.lastCreatedBlock = blockCreateEvents && blockCreateEvents.length > 0 ?
            blockCreateEvents.slice(-1)[0].args : { blockNumber: 0 }

        // TODO: maybe harvest block timestamps from provider in the background, save to store?
        //   Blocking could be very long in case of long-lived community...
        this.log(`Retrieving block timestamps for ${this.eventQueue.length} events...`)
        for (const event of this.eventQueue) {
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
        }

        this.log("Listening to joins/parts from the Channel...")
        this.channel.on("message", (topic, addresses, meta) => {
            // convert incoming addresses to checksum addresses
            const addressList = addresses.map(utils.getAddress)
            this.messageQueue.push({ topic, addressList, timestamp: meta.messageId.timestamp })
        })
        await this.channel.listen(playbackStartingTimestamp)    // replay messages until in sync
        this.channel.on("error", this.error)

        await this.playbackUntilBlock(this.lastCreatedBlock.blockNumber)

        // TODO: this should NOT be used for playbackUntilBlock, only for realtimeState
        this.log("Listening to Ethereum events...")
        this.token.on(tokenTransferFilter, async (to, from, amount, event) => {
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
            this.eventQueue.push(event)
            this.emit("tokensReceived", event)
        })

        this.contract.on(blockCreateFilter, async (to, from, amount, event) => {
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
            this.log(`Observed creation of block ${+event.args.blockNumber} at block ${event.blockNumber}`)
            this.lastCreatedBlock = event.args
            this.emit("blockCreated", event)
        })

        /*
        // TODO: ethers.js re-org handling
        this.tokenFilter.on("changed", event => {
            const i = this.eventQueue.findIndex(e => e.blockNumber === event.blockNumber && e.transactionIndex === event.transactionIndex)
            if (i > -1) {
                this.log(`Chain re-organization, event removed: ${JSON.stringify(event)}`)
                this.eventQueue.splice(i, 1)
            } else {
                // TODO: how to handle? This might invalidate old commits or mess the state,
                //   perhaps need to resync the whole thing (restart with config.reset=true),
                this.error(`Event removed in reorg, but not found in eventQueue: ${JSON.stringify(event)}`)
            }
        })
        this.tokenFilter.on("error", this.error)
        */
    }

    async stop() {
        this.tokenFilter.unsubscribe()
        this.channel.close()
    }

    /**
     * Advance the "committed" or "final" state which reflects the blocks committed by the operator
     * @param {Number} blockNumber from BlockCreated event
     */
    async playbackUntilBlock(blockNumber) {
        if (blockNumber <= this.state.lastBlockNumber) {
            this.log(`Playback skipped: block ${blockNumber} requested, ${this.state.lastBlockNumber} marked played back`)
            return
        }
        // TODO: use getLogs here to get the past events up to blockNumber instead of using this.eventQueue
        //   This is the MVP re-org handling mechanism: after finalityWaitPeriod, do a playback
        //   There's probably no need to do similar playback with messages since they're final on arrival
        //   It's fine to use the this.messageQueue though, the shouldn't change
        const timestamp = await this.getBlockTimestamp(blockNumber)
        this.log(`Playing back up to (end of) block ${blockNumber}, t = ${timestamp}`)
        const [oldEvents, newEvents] = partitionArray(this.eventQueue, event =>
            event.blockNumber <= blockNumber
        )
        const [oldMessages, newMessages] = partitionArray(this.messageQueue, msg =>
            msg.timestamp < timestamp
        )
        await replayOn(this.plasma, oldEvents, oldMessages)
        this.eventQueue = newEvents
        this.messageQueue = newMessages
        this.state.lastBlockNumber = blockNumber
    }

    /**
     * Cache the timestamps of blocks in milliseconds
     * TODO: also store the cache? It's immutable after all...
     * @param {Number} blockNumber
     */
    async getBlockTimestamp(blockNumber) {
        if (!(blockNumber in this.blockTimestampCache)) {
            const block = await this.eth.getBlock(blockNumber)
            this.blockTimestampCache[blockNumber] = block.timestamp * 1000
        }
        return this.blockTimestampCache[blockNumber]
    }

    /**
     * @returns {BigNumber} the number of token-wei held in the Monoplasma contract
     */
    async getContractTokenBalance() {
        const balance = await this.token.methods.balanceOf(this.state.contractAddress).call()
        return balance
    }
}
