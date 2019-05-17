const ethers = require("ethers")

const getFileStore = require("monoplasma/src/fileStore")

const MonoplasmaOperator = require("./operator")
const StreamrChannel = require("./streamrChannel")

const CommunityProductJson = require("../build/CommunityProduct.json")

const { throwIfNotSet } = require("./utils/checkArguments")

function addressEquals(a1, a2) {
    return ethers.utils.getAddress(a1) === ethers.utils.getAddress(a2)
}

/**
 * @typedef {string} EthereumAddress is hex string /0x[0-9A-Fa-f]^64/, return value from ethers.utils.getAddress
 */

module.exports = class CommunityProductServer {
    /**
     *
     * @param {Wallet} wallet from ethers.js
     */
    constructor(wallet, streamrApiKey, storeDir, operatorConfig, log, error) {
        throwIfNotSet(wallet, "Wallet argument to new CommunityProductServer")
        throwIfNotSet(streamrApiKey, "Streamr API key argument to new CommunityProductServer")
        throwIfNotSet(storeDir, "Store directory argument to new CommunityProductServer")

        this.wallet = wallet
        this.eth = wallet.provider
        this.log = log || console.log
        this.error = error || console.error
        this.communities = {}
        this.apiKey = streamrApiKey
        this.storeDir = storeDir
        this.operatorConfig = operatorConfig || {}
        //this.whitelist = whitelist    // TODO
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

    /**
     * Create a join/part channel for the community when operator is being created
     * Separated from startOperating to be better able to inject mocks in testing
     * @param {EthereumAddress} communityAddress of the community to be operated
     */
    async getChannelFor(communityAddress) {
        const address = ethers.utils.getAddress(communityAddress)
        const contract = new ethers.Contract(address, CommunityProductJson.abi, this.eth)
        const operatorAddress = await contract.operator()

        if (!addressEquals(operatorAddress, this.wallet.address)) {
            throw new Error(`Observed CommunityProduct requesting operator ${operatorAddress}, not a job for me (${this.wallet.address})`)
        }

        const joinPartStreamId = await contract.joinPartStream()

        // TODO: check streams actually exist AND permissions are correct
        if (!joinPartStreamId) {
            throw new Error(`Bad stream: ${joinPartStreamId}`)
        }

        const channel = new StreamrChannel(this.apiKey, joinPartStreamId)
        return channel
    }

    /**
     * Create a state and block store for the community when operator is being created
     * Separated from startOperating to be better able to inject mocks in testing
     * @param {EthereumAddress} communityAddress of the community to be operated
     */
    async getStoreFor(communityAddress) {
        const address = ethers.utils.getAddress(communityAddress)
        const storeDir = `${this.storeDir}/${address}`
        const fileStore = getFileStore(storeDir)
        return fileStore
    }

    async startOperating(communityAddress) {
        const address = ethers.utils.getAddress(communityAddress)
        const operatorChannel = await this.getChannelFor(address)
        const operatorStore = await this.getStoreFor(address)
        const log = (...args) => { this.log(`${address}> `, ...args) }
        const error = (...args) => { this.error(`${address}> `, ...args) }
        const config = Object.assign({}, this.operatorConfig)
        const operator = new MonoplasmaOperator(this.wallet, operatorChannel, operatorStore, log, error)
        await operator.start(config)

        const community = {
            address,
            operator,
        }
        this.communities[address] = community
        return community
    }
}