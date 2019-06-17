const MonoplasmaWatcher = require("./watcher")
const sleep = require("./utils/sleep-promise")
const { throwIfBadAddress } = require("./utils/checkArguments")

module.exports = class MonoplasmaOperator {

    constructor(wallet, ...args) {
        this.wallet = wallet
        this.watcher = new MonoplasmaWatcher(wallet.provider, ...args)
    }

    async start(config) {
        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress")

        this.finalityWaitPeriodSeconds = config.finalityWaitPeriodSeconds || 3600
        this.address = config.operatorAddress
        this.gasPrice = config.gasPrice || 4000000000  // 4 gwei

        // TODO: replace minIntervalBlocks with tokensNotCommitted (value-at-risk)
        this.minIntervalBlocks = config.minIntervalBlocks || 1
        //this.tokensNotCommitted = 0    // TODO: bignumber

        await this.watcher.start(config)

        this.watcher.on("tokensReceived", this.onTokensReceived.bind(this))
    }

    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    async onTokensReceived(event) {
        const blockNumber = event.blockNumber
        if (blockNumber > this.watcher.lastCreatedBlock.blockNumber + this.minIntervalBlocks) {
            this.log(`Waiting ${this.finalityWaitPeriodSeconds} sec before publishing block ${blockNumber} (hash=${hash})`)
            await sleep(this.finalityWaitPeriodSeconds * 1000)
            this.watcher.playbackUntil(blockNumber)
            const hash = this.watcher.plasma.getRootHash()
            const ipfsHash = ""     // TODO: upload this.watcher.plasma to IPFS
            await this.publishBlock(blockNumber, hash, ipfsHash)
        }
    }

    async publishBlock(blockNumber, hash, ipfsHash) {
        if (blockNumber <= this.watcher.lastCreatedBlock.blockNumber) {
            throw new Error(`Block #${this.watcher.lastCreatedBlock.blockNumber} has already been published, can't publish #${blockNumber}`)
        }
        await this.watcher.contract.commit(blockNumber, hash, ipfsHash).send({
            from: this.address,
            gas: 4000000,
            gasPrice: this.gasPrice
        })
        return this.watcher.plasma.storeBlock(blockNumber)
    }
}
