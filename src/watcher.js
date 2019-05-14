const EventEmitter = require("events")

const { Contract } = require("ethers")

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

        this.filters = {}
        this.eventLogIndex = +new Date()
    }

    /**
     * Sync the state into store, start listening to events and messages
     * @param {MonoplasmaConfig} config
     * @returns {Promise} resolves when MonoplasmaState is synced and listeners added
     */
    async start(config) {
        await throwIfSetButNotContract(this.eth, config.contractAddress, "contractAddress from initial config")
        throwIfSetButBadAddress(config.defaultReceiverAddress, "defaultReceiverAddress from initial config")

        this.log("Initializing Monoplasma state...")
        const savedState = config.reset ? {} : await this.store.loadState()
        this.state = Object.assign({}, savedState, config)

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
        const playbackStartingBlock = this.state.lastBlockNumber || 0
        const playbackStartingTimestamp = this.state.lastMessageTimestamp || 0

        const currentBlock = await this.eth.getBlockNumber()
        if (playbackStartingBlock <= currentBlock) {
            this.log(`Retrieving events from blocks ${playbackStartingBlock}...${currentBlock}`)
            const blockCreateEvents = await this.contract.getPastEvents("BlockCreated", { playbackStartingBlock, latestBlock: currentBlock })
            const transferEvents = await this.token.getPastEvents("Transfer", { filter: { to: this.state.contractAddress }, playbackStartingBlock, latestBlock: currentBlock })
            this.eventQueue = mergeEventLists(blockCreateEvents, transferEvents)
            this.lastCreatedBlock = blockCreateEvents.slice(-1)[0]
        }

        this.log("Listening to joins/parts from the Channel...")
        this.channel.on("message", (topic, addressList, meta) => {
            this.messageQueue.push({ topic, addressList, meta })
        })
        await this.channel.listen(playbackStartingTimestamp)    // replay messages until in sync
        this.channel.on("error", this.error)

        if (this.lastCreatedBlock) {
            const { blockNumber, transactionIndex } = this.lastCreatedBlock
            await this.playbackUntil(blockNumber, transactionIndex)
        }

        this.log("Listening to Ethereum events...")
        this.tokenFilter = this.token.events.Transfer({ filter: { to: this.state.contractAddress } })
        this.tokenFilter.on("data", event => {
            this.eventQueue.push(event)
        })
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
    }

    async playbackUntil(blockNumber, txIndex=1000000) {
        const block = await this.eth.getBlock(blockNumber)
        const timestamp = block.timestamp
        this.log(`Playing back until block ${blockNumber} tx ${txIndex}, t = ${timestamp}`)
        const [oldEvents, newEvents] = partitionArray(this.eventQueue, event =>
            event.blockNumber <= blockNumber && event.transactionIndex < txIndex
        )
        const [oldMessages, newMessages] = partitionArray(this.messageQueue, msg =>
            msg.timestamp < timestamp
        )
        await replayOn(this.plasma, oldEvents, oldMessages)
        this.eventQueue = newEvents
        this.messageQueue = newMessages
    }

    async stop() {
        this.tokenFilter.unsubscribe()
        this.channel.close()
    }

    /**
     * @returns {BigNumber} the number of token-wei held in the Monoplasma contract
     */
    async getContractTokenBalance() {
        const balance = await this.token.methods.balanceOf(this.state.contractAddress).call()
        return balance
    }
}
