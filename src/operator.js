const { Contract } = require("ethers")

const sleep = require("./utils/sleep-promise")
const { throwIfBadAddress } = require("./utils/checkArguments")

const MonoplasmaWatcher = require("./watcher")
const MonoplasmaState = require("./state")

const MonoplasmaJson = require("../build/Monoplasma.json")

const debug = require("debug")

module.exports = class MonoplasmaOperator {

    constructor(wallet, joinPartChannel, store) {
        this.wallet = wallet
        this.watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store)
        this.lastSavedBlock = null
    }

    async start(config) {
        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress")
        this.log = debug("Streamr::CPS::operator::" + config.contractAddress)

        this.finalityWaitPeriodSeconds = config.finalityWaitPeriodSeconds || 1 // TODO: in production || 3600
        this.address = config.operatorAddress
        this.gasPrice = config.gasPrice || 4000000000  // 4 gwei
        this.contract = new Contract(config.contractAddress, MonoplasmaJson.abi, this.wallet)

        // TODO: replace minIntervalBlocks with tokensNotCommitted (value-at-risk)
        this.minIntervalBlocks = config.minIntervalBlocks || 1
        //this.tokensNotCommitted = 0    // TODO: bignumber

        await this.watcher.start(config)
        //this.lastPublishedBlock = (this.watcher.state.lastPublishedBlock && this.watcher.state.lastPublishedBlock.blockNumber) || 0

        // TODO https://streamr.atlassian.net/browse/CPS-82 finalPlasmaStore should be instead just this.watcher.plasma.store
        const finalPlasmaStore = {
            saveBlock: async block => {
                this.lastSavedBlock = block
            }
        }
        this.finalPlasma = new MonoplasmaState(
            0,
            this.watcher.plasma.members,
            finalPlasmaStore,
            this.watcher.plasma.adminAddress,
            this.watcher.plasma.adminFee,
            this.watcher.plasma.currentBlock,
            this.watcher.plasma.currentTimestamp
        )

        this.watcher.on("tokensReceived", event => this.onTokensReceived(event))
    }

    async shutdown() {
        this.log("Shutting down operator for contract: " + this.watcher.state.contractAddress)
        await this.watcher.stop()
    }

    async lastPublishedBlock(){
        const lb = await this.watcher.plasma.store.getLatestBlock()
        if (lb == undefined) {
            return undefined
        }
        return lb.blockNumber
    }

    async onTokensReceived(...args) {
        return this._onTokensReceived(...args).catch((error) => this.log(error))
    }

    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    // see https://streamr.atlassian.net/browse/CPS-39
    async _onTokensReceived(event) {
        const last = await this.lastPublishedBlock()
        const blockNumber = event.blockNumber
        if (last == undefined || +blockNumber >= last + +this.minIntervalBlocks) {
            await this.publishBlock(blockNumber)
        } else {
            this.log(`Skipped publishing at ${blockNumber}, last publish at ${last} (this.minIntervalBlocks = ${this.minIntervalBlocks})`)
        }
    }

    async publishBlock(rootchainBlockNumber) {
        // enqueue publishBlock calls
        if (this.inProgressPublish) {
            this.log("Queued block publish", rootchainBlockNumber)
        }
        const task = Promise.resolve(this.inProgressPublish)
            .then(() => this._publishBlock(rootchainBlockNumber))
            .finally(() => {
                // last task cleans up
                if (this.inProgressPublish === task) {
                    this.inProgressPublish = undefined
                }
            })
        this.inProgressPublish = task
        return task
    }

    // TODO: call it commit instead. Replace all mentions of "publish" with "commit".
    /**
     * Sync watcher to the given block and publish the state AFTER it into blockchain
     * @param {Number} rootchainBlockNumber to sync up to
     * @returns {Promise<TransactionReceipt>}
     */
    async _publishBlock(rootchainBlockNumber) {
        // TODO: would mutex for publishing blocks make sense? Consider (finality wait period + delay) vs block publishing interval
        //if (this.publishBlockInProgress) { throw new Error(`Currently publishing block ${this.publishBlockInProgress}, please wait that it completes before attempting another`) }
        //this.publishBlockInProgress = blockNumber

        await sleep(0)          // ensure lastObservedBlockNumber is updated since this likely happens as a response to event
        const blockNumber = rootchainBlockNumber || this.watcher.state.lastObservedBlockNumber
        const lastPublishedBlock = await this.lastPublishedBlock()
        if (blockNumber <= lastPublishedBlock) { throw new Error(`Block #${lastPublishedBlock} has already been published, can't publish #${blockNumber}`) }
        const log = this.log.extend(blockNumber)
        log("Publish block", blockNumber)

        // see https://streamr.atlassian.net/browse/CPS-20
        // TODO: separate finalPlasma currently is so much out of sync with watcher.plasma that proofs turn out wrong
        //       perhaps communitiesRouter should get the proofs from operator's finalPlasma?
        //       perhaps operator's finalPlasma should write to store, and not watcher.plasma?
        // MVP re-org resilience is accomplished by assuming finality magically happens after finalityWaitPeriodSeconds
        //this.log(`Waiting ${this.finalityWaitPeriodSeconds} sec before publishing block ${blockNumber}`)
        //await sleep(this.finalityWaitPeriodSeconds * 1000)

        //await this.watcher.playbackUntilBlock(blockNumber, this.finalPlasma)
        //const hash = this.finalPlasma.getRootHash()
        const hash = this.watcher.plasma.getRootHash()  // TODO: remove, uncomment above
        const ipfsHash = ""     // TODO: upload this.finalPlasma to IPFS while waiting for finality

        const tx = await this.contract.commit(blockNumber, hash, ipfsHash)
        const tr = await tx.wait()        // confirmations

        // TODO https://streamr.atlassian.net/browse/CPS-82 should be instead:
        // await this.finalPlasma.storeBlock(blockNumber) // TODO: give a timestamp
        // this.watcher.state.lastPublishedBlock = {blockNumber: blockNumber}
        const commitTimestamp = (await this.contract.blockTimestamp(blockNumber)).toNumber()
        await this.watcher.plasma.storeBlock(blockNumber, commitTimestamp)
        await this.watcher.saveState()

        log("Commit sent, receipt:", tr)

        // TODO: something causes events to be replayed many times, resulting in wrong balances. It could have something to do with the state cloning that happens here
        // replace watcher's MonoplasmaState with the final "true" state that was just committed to blockchain
        // also sync it up to date because it's supposed to be "real time"
        // TODO: there could be a glitch here: perhaps an event gets replayed while syncing, it will be missed when watcher.plasma is overwritten
        //         of course it will be fixed again after next commit
        //this.watcher.setState(this.finalPlasma)
        //const currentBlock = await this.wallet.provider.getBlockNumber()
        //this.watcher.playbackUntilBlock(currentBlock)
        this.watcher.channelPruneCache()    // TODO: move inside watcher, maybe after playback
        //this.publishBlockInProgress = false
    }
}
