const { Contract } = require("ethers")

const sleep = require("./utils/sleep-promise")
const { throwIfBadAddress } = require("./utils/checkArguments")

const MonoplasmaWatcher = require("./watcher")

const MonoplasmaJson = require("../build/Monoplasma.json")

module.exports = class MonoplasmaOperator {

    constructor(wallet, joinPartChannel, store, logFunc, errorFunc) {
        this.wallet = wallet
        this.log = logFunc || (() => {})
        this.error = errorFunc || console.error
        this.watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store, logFunc, errorFunc)
    }

    async start(config) {
        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress")

        this.finalityWaitPeriodSeconds = config.finalityWaitPeriodSeconds || 1 // TODO: in production || 3600
        this.address = config.operatorAddress
        this.gasPrice = config.gasPrice || 4000000000  // 4 gwei

        // TODO: replace minIntervalBlocks with tokensNotCommitted (value-at-risk)
        this.minIntervalBlocks = config.minIntervalBlocks || 1
        //this.tokensNotCommitted = 0    // TODO: bignumber

        await this.watcher.start(config)
        this.contract = new Contract(this.watcher.state.contractAddress, MonoplasmaJson.abi, this.wallet)

        const self = this
        this.watcher.on("tokensReceived", async event => self.onTokensReceived(event).catch(self.error))
    }

    async shutdown(){
        this.log("Shutting down operator for contract: " + this.watcher.state.contractAddress)
        this.watcher.stop()
    }

    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    async onTokensReceived(event) {
        const blockNumber = event.blockNumber
        const lastBlock = this.lastPublishedBlock || this.watcher.lastCreatedBlock.blockNumber
        if (blockNumber >= lastBlock + this.minIntervalBlocks) {
            await this.publishBlock(blockNumber)
        } else {
            this.log(`Skipped publishing at ${blockNumber}, last publish at ${lastBlock}`)
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
        if (blockNumber <= this.watcher.lastCreatedBlock.blockNumber) {
            throw new Error(`Block #${this.watcher.lastCreatedBlock.blockNumber} has already been published, can't publish #${blockNumber}`)
        }
        this.lastPublishedBlock = blockNumber

        // MVP re-org resilience is accomplished by assuming finality magically happens after finalityWaitPeriodSeconds
        this.log(`Waiting ${this.finalityWaitPeriodSeconds} sec before publishing block ${blockNumber}`)
        await sleep(this.finalityWaitPeriodSeconds * 1000)

        await this.watcher.playbackUntilBlock(blockNumber)
        const hash = this.watcher.plasma.getRootHash()
        const ipfsHash = ""     // TODO: upload this.watcher.plasma to IPFS while waiting for finality

        const tx = await this.contract.commit(blockNumber, hash, ipfsHash)
        await this.watcher.plasma.storeBlock(blockNumber)
        return tx.wait(2)   // confirmations
        //this.publishBlockInProgress = false
    }
}
