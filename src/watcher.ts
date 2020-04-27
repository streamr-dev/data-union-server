import EventEmitter from "events"

import {Contract, utils} from "ethers"

import MonoplasmaState from "./state"
import { replayOn, mergeEventLists } from "./utils/events"
import { throwIfSetButNotContract, throwIfSetButBadAddress, EthereumAddress } from "./utils/checkArguments"
import bisectFindFirstIndex from "./utils/bisectFindFirstIndex"

import * as TokenContract from "../build/ERC20Mintable.json"
import { Provider } from "ethers/providers"
import { StreamrChannel } from "./streamrChannel"
const MonoplasmaJson = require("../build/Monoplasma.json")

const log = require("debug")("Streamr::dataunion::watcher")

// TODO: this typedef is foobar. How to get the real thing with JSDoc?
/** @typedef {number} BigNumber */

/**
 * Rewrote ethers.js parseLog mainly because of naming incompatibilities (also use of "this"... hrrr...)
 * This one pulls an ugly one and mutates incoming logs (adds "event" and "args")
 * It's here only until ethers.js v5 is out: "if you use v5, you can use contract.queryFilter, which will include the parsed events" https://github.com/ethers-io/ethers.js/issues/37
 *
 * @see https://github.com/ethers-io/ethers.js/blob/master/utils/interface.js#L357
 * @param {utils.Interface} contractAbi from ethers Contract.interface
 * @param {Array<utils.LogDescription>} logs from Provider.getLogs
 */
function parseLogs(contractAbi: utils.Interface, logs: Array<utils.LogDescription>) {
    for (const log of logs) {
        for (const type in contractAbi.events) {
            const event = contractAbi.events[type]
            if (event.topic === log.topics[0]) {
                log.event = event.name
                log.args = event.decode(log.data, log.topics)
            }
        }
    }
}

/**
 * MonoplasmaWatcher hooks to the Ethereum root chain contract and Streamr join/part stream
 * It syncs the state from Ethereum and Streamr into the store
 */
export class MonoplasmaWatcher extends EventEmitter {
    eth: Provider
    channel: StreamrChannel
    store: Store

    messageCache: Array

    constructor(eth: Provider, joinPartChannel, store : Store) {
        super()
        this.eth = eth
        this.channel = joinPartChannel
        this.store = store

        // TODO: move messageCache to streamrChannel? I.e. require playback of old messages.
        this.messageCache = []
        this.cachePrunedUpTo = 0    // TODO: this is here mostly for debug / error catching purposes

        this.filters = {}
        this.eventLogIndex = +new Date()
        this.blockTimestampCache = {}
    }

    /**
     * Sync the state into store, start listening to events and messages
     * @param {MonoplasmaConfig} config
     * @returns {Promise} resolves when MonoplasmaState is synced and listeners added
     */
    async start(config: MonoplasmaConfig): Promise<any> {
        await throwIfSetButNotContract(this.eth, config.contractAddress, "contractAddress from initial config")
        this.log = log.extend(config.contractAddress)

        // TODO: this isn't even used; maybe should throw if it's different from what contract gives?
        throwIfSetButBadAddress(config.adminAddress, "adminAddress from initial config")

        const network = await this.eth.getNetwork()
        this.log(`Connected to Ethereum network: ${JSON.stringify(network)}`)
        if (network.chainId === 1) {
            this.blockTimestampCache = require("../mainnet_timestamp_cache.json")
            this.log(`Loaded ${Object.keys(this.blockTimestampCache).length} block timestamps from disk`)
        }

        // this.state should be broken up into state.js, and rest called this.config
        this.log("Initializing Monoplasma state...")
        const savedState = config.reset ? {} : await this.store.loadState()
        this.state = Object.assign({
            adminFee: 0,
        }, savedState, config)


        this.eth.on("block", blockNumber => {
            if (blockNumber % 10 === 0) { this.log(`Block ${blockNumber} observed`) }
            this.state.lastObservedBlockNumber = blockNumber
        })


        // get initial state from contracts, also works as a sanity check for the config
        this.contract = new Contract(this.state.contractAddress, MonoplasmaJson.abi, this.eth)
        this.state.tokenAddress = await this.contract.token()
        this.state.adminAddress = await this.contract.owner()
        this.token = new Contract(this.state.tokenAddress, TokenContract.abi, this.eth)
        this.state.blockFreezeSeconds = (await this.contract.blockFreezeSeconds()).toString()
        this.log(`Read from contracts: freeze period = ${this.state.blockFreezeSeconds} sec, token @ ${this.state.tokenAddress}`)

        // TODO: next time a new event is added, DRY this (there's like 6 repetitions of listened events)
        this.adminFeeFilter = this.contract.filters.AdminFeeChanged()
        this.blockCreateFilter = this.contract.filters.NewCommit()
        this.tokenTransferFilter = this.token.filters.Transfer(null, this.contract.address)

        // let lastPublishedBlockNumber = this.state.lastPublishedBlock && this.state.lastPublishedBlock.blockNumber
        let lastBlock = {
            members: [],
            blockNumber: 0,
            timestamp: 0,
        }
        /*
        if (lastPublishedBlockNumber) {
            // quick fix for BigNumbers that have ended up in the store.json:
            //   they get serialized as {"_hex":"0x863a0a"}
            if (lastPublishedBlockNumber._hex) {
                lastPublishedBlockNumber = Number.parseInt(lastPublishedBlockNumber._hex)
            }
            this.log(`Reading from store lastPublishedBlockNumber ${lastPublishedBlockNumber}`)
            lastBlock = await this.store.loadBlock(lastPublishedBlockNumber)
        }
        */
        if (await this.store.hasLatestBlock()) {
            this.log("Getting latest block from store")
            lastBlock = await this.store.getLatestBlock()
            this.log(`Got ${JSON.stringify(lastBlock)}`)
        }
        this.log(`Syncing Monoplasma state starting from block ${lastBlock.blockNumber} (t=${lastBlock.timestamp}) with ${lastBlock.members.length} members`)
        const playbackStartingTimestampMs = lastBlock.timestamp || lastBlock.blockNumber && await this.getBlockTimestamp(lastBlock.blockNumber) || 0
        this.plasma = new MonoplasmaState({
            blockFreezeSeconds: this.state.blockFreezeSeconds,
            initialMembers: lastBlock.members,
            store: this.store,
            adminAddress: this.state.adminAddress,
            adminFeeFraction: this.state.adminFee,
            initialBlockNumber: lastBlock.blockNumber,
            initialTimestamp: playbackStartingTimestampMs / 1000,
        })

        this.log(`Getting joins/parts from the Channel starting from t=${playbackStartingTimestampMs}, ${new Date(playbackStartingTimestampMs).toISOString()}`)

        // replay and cache messages until in sync
        // TODO: cache only starting from given block (that operator/validator have loaded state from store)
        this.channel.on("message", (type: string, addresses: Array<EthereumAddress>, meta) => {
            this.log(`Message received: ${type} ${addresses}`)
            const addressList = addresses.map(utils.getAddress)
            const event = { type, addressList, timestamp: meta.messageId.timestamp }
            this.messageCache.push(event)
        })
        await this.channel.listen(playbackStartingTimestampMs)
        this.log(`Playing back ${this.messageCache.length} messages from joinPartStream`)

        // messages are now cached => do the Ethereum event playback, sync up this.plasma
        this.channel.on("error", this.log)
        const currentBlock = await this.eth.getBlockNumber()
        this.state.lastPublishedBlock = await this.playbackUntilBlock(currentBlock, this.plasma)

        // for messages from now on: add to cache but also replay directly to "realtime plasma"
        this.channel.on("message", async (type, addresses, meta) => {
            // convert incoming addresses to checksum addresses
            const addressList = addresses.map(utils.getAddress)
            const event = { type, addressList, timestamp: meta.messageId.timestamp }
            this.log(`Members ${type}: ${addressList}`)
            await replayOn(this.plasma, [event])
            this.emit(type, addresses)
        })

        this.log("Listening to Ethereum events...")
        this.contract.on(this.adminFeeFilter, async (adminFee, event) => {
            this.log(`Admin fee changed to ${utils.formatEther(adminFee)} at block ${event.blockNumber}`)
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
            await replayOn(this.plasma, [event])
            this.emit("adminFeeChanged", event)
        })
        this.contract.on(this.blockCreateFilter, async (blockNumber, rootHash, ipfsHash, event) => {
            this.log(`Observed creation of block ${+blockNumber} at block ${event.blockNumber} (root ${rootHash}, ipfs "${ipfsHash}")`)
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
            //this.state.lastPublishedBlock = event.args
            this.emit("blockCreated", event)
        })
        this.token.on(this.tokenTransferFilter, async (to, from, amount, event) => {
            this.log(`Received ${utils.formatEther(event.args.value)} DATA`)
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
            await replayOn(this.plasma, [event])
            this.emit("tokensReceived", event)
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

        this.eth.on("block", blockNumber => {
            if (blockNumber % 10 === 0) { this.log(`Block ${blockNumber} observed`) }
            this.state.lastObservedBlockNumber = blockNumber
        })

        // TODO: maybe state saving function should create the state object instead of continuously mutating "state" member
        await this.saveState()
    }

    async saveState() {
        return this.store.saveState(this.state)
    }

    async stop() {
        //this.tokenFilter.unsubscribe()
        await this.channel.close()
    }

    /**
     * Clone given state and overwrite current MonoplasmaState of the watcher
     * @param {MonoplasmaState} monoplasmaState original to be copied
     */
    setState(monoplasmaState: MonoplasmaState) {
        this.plasma = new MonoplasmaState({
            blockFreezeSeconds: this.state.blockFreezeSeconds,
            initialMembers: monoplasmaState.members,
            store: this.store,
            adminAddress: this.state.adminAddress,
            adminFeeFraction: this.state.adminFee,
            initialBlockNumber: monoplasmaState.blockNumber,
            initialTimestamp: monoplasmaState.timestamp,
        })
    }

    /**
     * Advance the "committed" or "final" state which reflects the blocks committed by the operator
     * @param {Number} toBlock is blockNumber from BlockCreated event
     * @param {MonoplasmaState} plasma to sync, default is this watcher's "realtime state"
     */
    async playbackUntilBlock(toBlock: number, plasma: MonoplasmaState) {
        if (!plasma) { plasma = this.plasma }
        const fromBlock = plasma.currentBlock + 1 || 0      // JSON RPC filters are inclusive, hence +1
        if (toBlock <= fromBlock) {
            this.log(`Playback skipped: block ${toBlock} requested, already at ${fromBlock}`)
            return
        }

        const fromTimestamp = plasma.currentTimestamp || 0
        const toTimestamp = await this.getBlockTimestamp(toBlock)
        if (fromTimestamp < this.cachePrunedUpTo) {
            throw new Error(`Cache has been pruned up to ${this.cachePrunedUpTo}, can't play back correctly ${fromTimestamp}...${toTimestamp}`)
        }

        this.log(`Retrieving from blocks ${fromBlock}...${toBlock}`)
        const adminFeeFilter = Object.assign({}, this.adminFeeFilter,  { fromBlock, toBlock })
        const blockCreateFilter = Object.assign({}, this.blockCreateFilter, { fromBlock, toBlock })
        const tokenTransferFilter = Object.assign({}, this.tokenTransferFilter,  { fromBlock, toBlock })
        const adminFeeEvents = await this.eth.getLogs(adminFeeFilter)
        const blockCreateEvents = await this.eth.getLogs(blockCreateFilter)
        const transferEvents = await this.eth.getLogs(tokenTransferFilter)

        // "if you use v5, you can use contract.queryFilter, which will include the parsed events" https://github.com/ethers-io/ethers.js/issues/37
        parseLogs(this.contract.interface, adminFeeEvents)
        parseLogs(this.contract.interface, blockCreateEvents)
        parseLogs(this.token.interface, transferEvents)

        const events = mergeEventLists(mergeEventLists(adminFeeEvents, blockCreateEvents), transferEvents)

        // TODO: maybe harvest block timestamps from provider in the background after start-up, save to store?
        //   Blocking here could last very long during first playback in case of long-lived data union with long join-part-history...
        this.log(`Retrieving block timestamps for ${events.length} events...`)
        for (const event of events) {
            event.timestamp = await this.getBlockTimestamp(event.blockNumber)
        }

        this.log(`Getting messages between ${fromTimestamp}...${toTimestamp} from cache`)
        const fromIndex = bisectFindFirstIndex(this.messageCache, msg => msg.timestamp > fromTimestamp)
        const toIndex = bisectFindFirstIndex(this.messageCache, msg => msg.timestamp > toTimestamp)
        const messages = this.messageCache.slice(fromIndex, toIndex)

        this.log(`Replaying ${events.length} events and ${messages.length} messages`)
        await replayOn(plasma, events, messages)
        plasma.currentBlock = toBlock
        plasma.currentTimestamp = toTimestamp

        // TODO: smarter way to pass this to start()
        const lastPublishedBlock = blockCreateEvents && blockCreateEvents.length > 0 ? blockCreateEvents.slice(-1)[0].args : { blockNumber: 0 }
        return lastPublishedBlock
    }

    /**
     * Prune message cache after they aren't going to be needed anymore
     * TODO: move to streamrChannel as channelPruneCache(lastRemovedTimestamp)
     * TODO: @param {Number} lastRemovedTimestamp up to which messages are dropped
     */
    channelPruneCache() {
        const lastRemovedTimestamp = this.plasma.currentTimestamp
        const keepIndex = bisectFindFirstIndex(this.messageCache, msg => msg.timestamp > lastRemovedTimestamp)
        this.messageCache = this.messageCache.slice(keepIndex)
        this.cachePrunedUpTo = lastRemovedTimestamp
    }

    /**
     * Cache the timestamps of blocks in milliseconds
     * TODO: also store the cache? It's immutable after all...
     * @param {Number} blockNumber
     */
    async getBlockTimestamp(blockNumber: number) {
        if (!(blockNumber in this.blockTimestampCache)) {
            this.log(`blockTimestampCache miss for block number ${blockNumber}`)
            this.blockTimestampCache[blockNumber] = (async () => {
                const block = await this.eth.getBlock(blockNumber)
                if (!block) {
                    throw new Error(`No timestamp exists from block ${blockNumber}`)
                }
                return block.timestamp * 1000
            })()
        }
        return await this.blockTimestampCache[blockNumber]
    }

    /**
     * @returns {BigNumber} the number of token-wei held in the Monoplasma contract
     */
    async getContractTokenBalance(): BigNumber {
        const balance = await this.token.methods.balanceOf(this.state.contractAddress).call()
        return balance
    }
}
