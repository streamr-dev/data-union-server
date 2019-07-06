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

    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    async onTokensReceived(event) {
        const blockNumber = event.blockNumber
        if (blockNumber >= this.watcher.lastCreatedBlock.blockNumber + this.minIntervalBlocks) {
            await this.publishBlock(blockNumber)
        }
    }

    /**
     * Sync watcher to the given block and publish the state AFTER it into blockchain
     * @param {Number} blockNumber to sync up to
     * @returns {Promise<TransactionReceipt>}
     */
    async publishBlock(blockNumber) {
        //if (this.publishBlockInProgress) { throw new Error(`Currently publishing block ${this.publishBlockInProgress}, please wait that it completes before attempting another`) }
        //this.publishBlockInProgress = blockNumber
        await sleep(0)          // ensure lastObservedBlockNumber is updated since this likely happens as a response to event

        const bnum = blockNumber || this.watcher.state.lastObservedBlockNumber
        await this.watcher.playbackUntilBlock(bnum)
        const hash = this.watcher.plasma.getRootHash()
        const ipfsHash = ""     // TODO: upload this.watcher.plasma to IPFS while waiting for finality

        this.log(`Waiting ${this.finalityWaitPeriodSeconds} sec before publishing block ${bnum} (hash=${hash})`)
        await sleep(this.finalityWaitPeriodSeconds * 1000)
        if (bnum <= this.watcher.lastCreatedBlock.blockNumber) {
            throw new Error(`Block #${this.watcher.lastCreatedBlock.blockNumber} has already been published, can't publish #${bnum}`)
        }
        const tx = await this.contract.commit(bnum, hash, ipfsHash)
        await this.watcher.plasma.storeBlock(bnum)
        return tx.wait(2)   // confirmations
        //this.publishBlockInProgress = false
    }
}
