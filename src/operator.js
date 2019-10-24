const { Contract } = require("ethers")

const sleep = require("./utils/sleep-promise")
const { throwIfBadAddress } = require("./utils/checkArguments")

const MonoplasmaWatcher = require("./watcher")
const MonoplasmaState = require("monoplasma/src/state")

const MonoplasmaJson = require("../build/Monoplasma.json")

module.exports = class MonoplasmaOperator {

    constructor(wallet, joinPartChannel, store, logFunc, errorFunc) {
        this.wallet = wallet
        this.log = logFunc || (() => {})
        this.error = errorFunc || console.error
        this.watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store, logFunc, errorFunc)
        this.lastSavedBlock = null
    }

    async start(config) {
        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress")

        this.finalityWaitPeriodSeconds = config.finalityWaitPeriodSeconds || 1 // TODO: in production || 3600
        this.address = config.operatorAddress
        this.gasPrice = config.gasPrice || 4000000000  // 4 gwei
        this.contract = new Contract(config.contractAddress, MonoplasmaJson.abi, this.wallet)

        // TODO: replace minIntervalBlocks with tokensNotCommitted (value-at-risk)
        this.minIntervalBlocks = config.minIntervalBlocks || 1
        //this.tokensNotCommitted = 0    // TODO: bignumber

        await this.watcher.start(config)
        this.lastPublishedBlock = (this.watcher.state.lastPublishedBlock && this.watcher.state.lastPublishedBlock.blockNumber) || 0

        // TODO: replace after Monoplasma update:
        // this.finalPlasma = this.watcher.plasma.clone({
        //     saveBlock: async block => {
        //         this.lastSavedBlock = block
        //     }
        // })
        this.finalPlasma = new MonoplasmaState(0, this.watcher.plasma.members, {
            saveBlock: async block => {
                this.lastSavedBlock = block
            }
        }, this.watcher.plasma.adminAddress, this.watcher.plasma.adminFee, this.watcher.plasma.currentBlock, this.watcher.plasma.currentTimestamp)

        const self = this
        this.watcher.on("tokensReceived", async event => self.onTokensReceived(event).catch(self.error))
    }

    async shutdown() {
        this.log("Shutting down operator for contract: " + this.watcher.state.contractAddress)
        this.watcher.stop()
    }

    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    async onTokensReceived(event) {
        const blockNumber = event.blockNumber
        if (blockNumber >= this.lastPublishedBlock + this.minIntervalBlocks) {
            await this.publishBlock(blockNumber)
        } else {
            this.log(`Skipped publishing at ${blockNumber}, last publish at ${this.lastPublishedBlock} (this.minIntervalBlocks = ${this.minIntervalBlocks})`)
        }
    }

    /**
     * Sync watcher to the given block and publish the state AFTER it into blockchain
     * @param {Number} rootchainBlockNumber to sync up to
     * @returns {Promise<TransactionReceipt>}
     */
    async publishBlock(rootchainBlockNumber) {
        // TODO: would mutex for publishing blocks make sense? Consider (finality wait period + delay) vs block publishing interval
        //if (this.publishBlockInProgress) { throw new Error(`Currently publishing block ${this.publishBlockInProgress}, please wait that it completes before attempting another`) }
        //this.publishBlockInProgress = blockNumber

        await sleep(0)          // ensure lastObservedBlockNumber is updated since this likely happens as a response to event
        const blockNumber = rootchainBlockNumber || this.watcher.state.lastObservedBlockNumber
        if (blockNumber <= this.lastPublishedBlock) { throw new Error(`Block #${this.lastPublishedBlock} has already been published, can't publish #${blockNumber}`) }
        this.lastPublishedBlock = blockNumber

        // MVP re-org resilience is accomplished by assuming finality magically happens after finalityWaitPeriodSeconds
        this.log(`Waiting ${this.finalityWaitPeriodSeconds} sec before publishing block ${blockNumber}`)
        await sleep(this.finalityWaitPeriodSeconds * 1000)

        await this.watcher.playbackUntilBlock(this.finalPlasma, blockNumber)
        const hash = this.finalPlasma.getRootHash()
        const ipfsHash = ""     // TODO: upload this.finalPlasma to IPFS while waiting for finality

        const tx = await this.contract.commit(blockNumber, hash, ipfsHash)
        await this.watcher.plasma.storeBlock(blockNumber)
        await tx.wait(1)   // confirmations

        // replace watcher's MonoplasmaState with the final "true" state that was just committed to blockchain
        // also sync it up to date because it's supposed to be "real time"
        // TODO: there could be a glitch here: perhaps an event gets replayed while syncing, it will be missed when watcher.plasma is overwritten
        //         of course it will be fixed again after next commit
        const updatedState = new MonoplasmaState(
            this.watcher.plasma.blockFreezeSeconds,
            this.finalPlasma.members,
            this.watcher.plasma.store,
            this.finalPlasma.adminAddress,
            this.finalPlasma.adminFee,
            this.finalPlasma.currentBlock,
            this.finalPlasma.currentTimestamp
        )
        const currentBlock = await this.wallet.provider.getBlockNumber()
        this.watcher.playbackUntilBlock(updatedState, currentBlock)
        this.watcher.plasma = updatedState
        this.watcher.channelPruneCache()
        //this.publishBlockInProgress = false
    }
}
