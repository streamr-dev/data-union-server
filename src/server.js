const ethers = require("ethers")

const getFileStore = require("monoplasma/src/fileStore")

const MonoplasmaOperator = require("./operator")
const StreamrChannel = require("./streamrChannel")

const CommunityProductJson = require("../build/CommunityProduct.json")

const { throwIfNotSet } = require("./utils/checkArguments")

const operatorChangedEventTopic =  ethers.utils.id("OperatorChanged(address)")
const operatorChangedAbi = ["event OperatorChanged(address indexed newOperator)"]
const operatorChangedInterface = new ethers.utils.Interface(operatorChangedAbi)

function addressEquals(a1, a2) {
    return ethers.utils.getAddress(a1) === ethers.utils.getAddress(a2)
}

/**
 * @typedef {string} EthereumAddress is hex string /0x[0-9A-Fa-f]^64/, return value from ethers.utils.getAddress
 */

/**
 * @property {Map<EthereumAddress, Community>} communities
 */
module.exports = class CommunityProductServer {
    /**
     *
     * @param {Wallet} wallet from ethers.js
     */
    constructor(wallet, storeDir, operatorConfig, log, error) {
        throwIfNotSet(wallet, "Wallet argument to new CommunityProductServer")
        throwIfNotSet(storeDir, "Store directory argument to new CommunityProductServer")

        this.wallet = wallet
        this.eth = wallet.provider
        this.log = log || console.log
        this.error = error || console.error
        this.communities = {}       // mapping: Ethereum address => Community object
        this.storeDir = storeDir
        this.operatorConfig = operatorConfig || {}
        this.communityIsRunningPromises = {}
        //this.whitelist = whitelist    // TODO
        //this.blacklist = blacklist
    }

    async start() {
        await this.playbackPastOperatorChangedEvents()

        this.eth.on({ topics: [operatorChangedEventTopic] }, log => {
            let event = operatorChangedInterface.parseLog(log)
            this.log("Seen OperatorChanged event: "+JSON.stringify(event))
            const contractAddress = ethers.utils.getAddress(log.address)
            this.onOperatorChangedEventAt(contractAddress).catch(err => {
                this.error(err.stack)
            })
        })
    }

    async stop() {
        this.eth.removeAllListeners({ topics: [operatorChangedEventTopic] })
        // TODO: hand over operators to another server?
    }

    async playbackPastOperatorChangedEvents(){
        //playback events of OperatorChanged(this wallet)
        const filter = {
            fromBlock: 1,
            toBlock: "latest",
            topics: [operatorChangedEventTopic, ethers.utils.hexlify(ethers.utils.padZeros(this.wallet.address,32))]
        }

        const logs = await this.eth.getLogs(filter)

        for(let log of logs) {
            let event = operatorChangedInterface.parseLog(log)
            this.log("Playing back past OperatorChanged event: "+ JSON.stringify(event))
            const contractAddress = ethers.utils.getAddress(log.address)
            await this.onOperatorChangedEventAt(contractAddress).catch(err => {
                this.error(err.stack)
            })                
        }
    }

    /**
     * Filter how to respond to OperatorChanged events, pass new communities to startOperating
     * TODO: abuse defenses could be replaced with bytecode checking or similar if feasible
     * @param {string} address
     */
    async onOperatorChangedEventAt(address) {
        const contract = new ethers.Contract(address, CommunityProductJson.abi, this.eth)
        const newOperatorAddress = await contract.operator()
        const weOperate = addressEquals(newOperatorAddress, this.wallet.address)
        const community = this.communities[address]
        if (community) {
            if (!community.operator || !community.operator.contract) {
                // abuse mitigation: only serve one per event.address
                //   normally CommunityProduct shouldn't send several requests (potential spam attack attempt)
                this.error(`Too rapid OperatorChanged events from ${address}, community is still launching`)
                return
            }
            if (weOperate) {
                this.error(`Repeated OperatorChanged("${newOperatorAddress}") events from ${address}`)
                return
            } else {
                // operator was changed, we can stop running the operator process
                await community.operator.shutdown()
                delete this.communities[address]
            }
        } else if (weOperate) {
            // rapid event spam stopper (from one contract)
            this.communities[address] = {
                state: "launching",
                eventDetectedAt: Date.now(),
            }

            try {
                const result = await this.startOperating(address)
                if (address in this.communityIsRunningPromises) {
                    this.communityIsRunningPromises[address].setRunning(result)
                }
            } catch (err) {
                if (address in this.communityIsRunningPromises) {
                    this.communityIsRunningPromises[address].setFailed(err)
                }
            }
        }
    }

    /**
     * Helper function to await community deployments (after smart contract sent)
     * @param {EthereumAddress} address of the community to watch
     * @returns {Promise} that resolves when community is successfully started, or fails if starting fails
     */
    async communityIsRunning(address) {
        if (!(address in this.communityIsRunningPromises)) {
            let setRunning, setFailed
            const promise = new Promise((done, fail) => {
                setRunning = done
                setFailed = fail
            })
            this.communityIsRunningPromises[address] = {
                promise, setRunning, setFailed
            }
        }
        return this.communityIsRunningPromises[address].promise
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

        const joinPartStreamName = await contract.joinPartStream()

        // TODO: check streams actually exist AND permissions are correct
        if (!joinPartStreamName) {
            throw new Error(`Bad stream: ${joinPartStreamName}`)
        }

        const channel = new StreamrChannel(this.wallet.privateKey, joinPartStreamName)
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
        console.log(`Storing community ${communityAddress} data at ${storeDir}`)
        const fileStore = getFileStore(storeDir)
        return fileStore
    }

    async startOperating(communityAddress) {
        const address = ethers.utils.getAddress(communityAddress)
        const operatorChannel = await this.getChannelFor(address)
        const operatorStore = await this.getStoreFor(address)
        const log = (...args) => { this.log(`${address}> `, ...args) }
        const error = (e, ...args) => { this.error(e, `\n${address}> `, ...args) }
        const config = Object.assign({}, this.operatorConfig, { contractAddress: address })
        const operator = new MonoplasmaOperator(this.wallet, operatorChannel, operatorStore, log, error)
        await operator.start(config)

        const community = {
            state: "running",
            address,
            operator,
            joinPartStreamName: operatorChannel.joinPartStreamName,
        }
        this.communities[address] = community
        return community
    }
}
