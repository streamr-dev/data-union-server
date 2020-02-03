const { Contract } = require("ethers")

const { throwIfBadAddress } = require("./utils/checkArguments")

const MonoplasmaState = require("./state")
const MonoplasmaWatcher = require("./watcher")

const MonoplasmaJson = require("../build/Monoplasma.json")

const debug = require("debug")

module.exports = class MonoplasmaValidator {
    constructor(watchedAccounts, wallet, joinPartChannel, store) {
        this.watchedAccounts = watchedAccounts
        this.wallet = wallet
        this.watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store)

        this.eventQueue = []
        this.lastSavedBlock = null
    }

    async start(config) {
        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress")
        this.log = debug("Streamr::CPS::validator::" + config.contractAddress)

        this.contract = new Contract(config.contractAddress, MonoplasmaJson.abi, this.wallet)
        await this.watcher.start(config)

        this.validatedPlasma = new MonoplasmaState(0, [], {
            saveBlock: async block => {
                this.lastSavedBlock = block
            }
        }, this.watcher.plasma.adminAddress, this.watcher.plasma.adminFee, this.watcher.plasma.currentBlock, this.watcher.plasma.currentTimestamp)

        const self = this
        this.log("Starting validator's BlockCreated listener")
        this.watcher.on("blockCreated", event => self.checkBlock(event.args).catch(self.error))
    }

    async checkBlock(block) {
        // add the block to store; this won't be done by Watcher because Operator does it now
        // TODO: move this to Watcher
        const blockNumber = +block.blockNumber
        this.plasma.storeBlock(blockNumber)

        // update the "validated" version to the block number whose hash was published
        await this.watcher.playbackUntilBlock(blockNumber, this.validatedPlasma)
        this.watcher.channelPruneCache()
        this.lastCheckedBlock = blockNumber

        // check that the hash at that point in history matches
        // TODO: get hash from this.lastSavedBlock
        // TODO: if there's a Transfer after BlockCreated in same block, current approach breaks
        const hash = this.validatedPlasma.getRootHash()
        if (hash === block.rootHash) {
            this.log(`Root hash @ ${blockNumber} validated.`)
            this.lastValidatedBlock = blockNumber
            this.lastValidatedMembers = this.watchedAccounts.map(address => this.validatedPlasma.getMember(address))
        } else {
            // TODO: this.emit()?
            this.log(`WARNING: Discrepancy detected @ ${blockNumber}!`)
            // TODO: recovery attempt logic before gtfo and blowing up everything?
            // TODO: needs more research into possible and probable failure modes
            await this.exit(this.lastValidatedBlock, this.lastValidatedMembers)
        }
    }

    /**
     * @param Number blockNumber of the block where exit is attempted
     * @param List<MonoplasmaMember> members during the block where exit is attempted
     */
    async exit(blockNumber, members) {
        // TODO: sleep until block freeze period is over

        // There should be no hurry, so sequential execution is ok, and it might hurt to send() all at once.
        // TODO: Investigate and compare
        //return Promise.all(members.map(m => contract.methods.withdrawAll(blockNumber, m.earnings, m.proof).send(opts)))
        for (const m of members) {
            this.log(`Recording the earnings for ${m.address}: ${m.earnings}`)
            const tx = await this.contract.prove(blockNumber, m.address, m.earnings, m.proof)
            const tr = await tx.wait(2)
            this.log(`"Prove" transaction: ${JSON.stringify(tr)}`)
        }
    }
}
