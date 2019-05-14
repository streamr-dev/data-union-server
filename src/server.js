const ethers = require("ethers")

const getFileStore = require("monoplasma/src/fileStore")

const MonoplasmaOperator = require("./operator")
const StreamrChannel = require("./streamrChannel")

const CommunityProductJson = require("../build/CommunityProduct.json")

function addressEquals(a1, a2) {
    return ethers.utils.getAddress(a1) === ethers.utils.getAddress(a2)
}

module.exports = class CommunityProductServer {
    /**
     *
     * @param {Wallet} wallet from ethers.js
     */
    constructor(wallet, streamrApiKey, storeDir, operatorConfig) {
        this.wallet = wallet
        this.eth = wallet.provider
        this.log = console.log
        this.error = console.error
        this.communities = {}
        this.apiKey = streamrApiKey
        this.storeDir = storeDir
        this.operatorConfig = operatorConfig
        //this.whitelist = whitelist
        //this.blacklist = blacklist
    }

    async start() {
        // TODO: check out https://github.com/ConsenSys/ethql for finding all CommunityProductCreated
        this.eth.on("block", blockNumber => {
            this.log(`Block ${blockNumber} observed`)
        })
        this.eth.on({ topics: [ethers.utils.id("OperatorChanged(address)")] }, async event => {
            this.log(JSON.stringify(event))
            const contractAddress = ethers.utils.getAddress(event.address)
            await this.onOperatorChangeEventAt(contractAddress)
        })
    }

    async stop() {
        // TODO: hand over operators to another server?
    }

    /**
     * Filter how to respond to OperatorChanged events, pass new communities to startOperating
     * TODO: abuse defenses could be replaced with bytecode checking or similar if feasible
     * @param {string} address
     */
    async onOperatorChangedEventAt(address) {
        const community = this.communities[address]
        if (community) {
            if (!community.contract) {
                // abuse mitigation: only serve one per event.address
                //   normally CommunityProduct shouldn't send several requests
                this.error(`Very rapid OperatorChanged events from ${address}`)
                return
            }
            const newOperatorAddress = await community.contract.operator()
            if (addressEquals(newOperatorAddress, this.wallet.address)) {
                this.error(`Repeated OperatorChanged events from ${address}`)
                return
            } else {
                // operator was changed, we can stop running the operator process
                await community.operator.shutdown()
                delete this.communities[address]
            }
        } else {
            // rapid event spam stopper (from one contract)
            this.communities[address] = {}

            await this.startOperating(address)
        }
    }

    async startOperating(address) {
        const addr = ethers.utils.getAddress(address)
        const contract = new ethers.Contract(addr, CommunityProductJson.abi, this.eth)
        const operatorAddress = await contract.operator()

        if (!addressEquals(operatorAddress, this.wallet.address)) {
            console.log(`Observed CommunityProduct requesting operator ${operatorAddress}, that's not work for me (${this.wallet.address})`)
            return
        }

        const joinPartStreamId = await contract.joinPartStream()

        // TODO: check streams actually exist AND permissions are correct
        if (!joinPartStreamId) { throw new Error(`Bad stream: ${joinPartStreamId}`) }

        const operatorChannel = new StreamrChannel(this.apiKey, joinPartStreamId)

        const log = (...args) => { this.log(`${address}> `, ...args) }
        const error = (...args) => { this.error(`${address}> `, ...args) }
        const storeDir = `${this.storeDir}/${address}`
        const fileStore = getFileStore(storeDir)
        const config = Object.assign({}, this.operatorConfig)
        const operator = new MonoplasmaOperator(this.wallet, operatorChannel, fileStore, log, error)
        await operator.start(config)

        this.communities[address] = {
            address,
            contract,
            operator,
        }
    }
}
