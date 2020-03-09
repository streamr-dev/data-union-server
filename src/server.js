const {
    Contract,
    utils: { id, getAddress, hexZeroPad, Interface }
} = require("ethers")

const debug = require("debug")
const pAll = require("p-all")

const FileStore = require("./fileStore")
const MonoplasmaOperator = require("./operator")
const StreamrChannel = require("./streamrChannel")

const CommunityProductJson = require("../build/CommunityProduct.json")

const { throwIfNotSet } = require("./utils/checkArguments")

const operatorChangedEventTopic = id("OperatorChanged(address)")
const operatorChangedAbi = ["event OperatorChanged(address indexed newOperator)"]
const operatorChangedInterface = new Interface(operatorChangedAbi)

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
        this.log = log || debug("Streamr::CPS::server")   // TODO: don't pass log func in constructor
        this.error = error || console.error // eslint-disable-line no-console
        this.communities = {}       // mapping: Ethereum address => Community object
        this.storeDir = storeDir
        this.operatorConfig = operatorConfig || {}
        this.communityIsRunningPromises = {}
        //this.whitelist = whitelist    // TODO
        //this.blacklist = blacklist
        this.startCalled = false
    }

    async start() {
        if (this.startCalled) { throw new Error("Cannot re-start stopped server.") }
        this.startCalled = true // guard against starting multiple times
        await this.playbackPastOperatorChangedEvents()

        this.eth.on({ topics: [operatorChangedEventTopic] }, log => {
            let event = operatorChangedInterface.parseLog(log)
            this.log("Seen OperatorChanged event: " + JSON.stringify(event))
            const contractAddress = getAddress(log.address)
            this.onOperatorChangedEventAt(contractAddress).catch(err => {
                this.error(err.stack)
            })
        })
    }

    async stop() {
        // TODO: hand over operators to another server?
        const communities = this.communities
        this.communities = {}
        this.communityIsRunningPromises = {}
        this.eth.removeAllListeners({ topics: [operatorChangedEventTopic] })
        await Promise.all(Object.values(communities).map((community) => (
            community.operator && community.operator.shutdown()
        )))
    }

    async playbackPastOperatorChangedEvents() {
        //playback events of OperatorChanged(this wallet)
        const filter = {
            fromBlock: 1,
            toBlock: "latest",
            topics: [operatorChangedEventTopic, hexZeroPad(this.wallet.address, 32).toLowerCase()]
        }

        // TODO: remove communities that have been switched away, so not to (start and) stop operators during playback

        const logs = await this.eth.getLogs(filter)

        // get unique addresses
        const addresses = Array.from(new Set(logs.map((log) => getAddress(log.address))))

        const total = addresses.length
        this.log(`Playing back ${total} operator change events...`)
        let numErrors = 0
        let numComplete = 0
        const startAllTime = Date.now()
        await pAll(addresses.map((contractAddress) => () => {
            const startEventTime = Date.now()
            return this.onOperatorChangedEventAt(contractAddress).catch((err) => {
                // TODO: while developing, 404 for joinPartStream could just mean
                //   mysql has been emptied by streamr-ganache docker not,
                //   so some old joinPartStreams are in ganache but not in mysql
                //   Solution is to `streamr-docker-dev restart ganache`
                // For production on the other hand... 404 could be bad.
                //   Streamr might have lost joinPartStreams, and they should be re-created from
                //   the last valid monoplasma members lists if such are available (IPFS sharing anyone?)
                this.error(err.stack)
                // keep chugging, only give up if all fail
                numErrors++
            }).then(() => {
                numComplete++
                this.log(`Event ${numComplete} of ${total} processed in ${Date.now() - startEventTime}ms, ${Math.round((numComplete / total) * 100)}% complete.`)
            })
        }), { concurrency: 6 })

        this.log(`Finished playback of ${total} operator change events in ${Date.now() - startAllTime}ms.`)
        const numCommunities = Object.keys(this.communities).length
        if (numErrors && numErrors === numCommunities) {
            // kill if all operators errored
            throw new Error(`All ${numCommunities} communities failed to start. Shutting down.`)
        }
    }

    /**
     * Filter how to respond to OperatorChanged events, pass new communities to startOperating
     * TODO: abuse defenses could be replaced with bytecode checking or similar if feasible
     * @param {string} address
     */
    async onOperatorChangedEventAt(address) {
        const contract = new Contract(address, CommunityProductJson.abi, this.eth)
        // create the promise to prevent later (duplicate) creation
        const isRunningPromise = this.communityIsRunning(address)
        const status = this.communityIsRunningPromises[address]
        const { communities } = this
        const community = communities[address]
        const newOperatorAddress = getAddress(await contract.operator())
        const weShouldOperate = newOperatorAddress === this.wallet.address
        if (!community) {
            if (weShouldOperate) {
                // rapid event spam stopper (from one contract)
                communities[address] = {
                    state: "launching",
                    eventDetectedAt: Date.now(),
                }

                let result
                let error
                try {
                    result = await this.startOperating(address)
                } catch (err) {
                    error = err
                }

                if (error) {
                    if (communities[address]) {
                        communities[address] = {
                            state: "failed",
                            error,
                            eventDetectedAt: communities[address].eventDetectedAt,
                            failedAt: Date.now(),
                        }
                    }
                    status.setFailed(error)
                } else {
                    status.setRunning(result)
                }
            } else {
                this.log(`Detected a community for operator ${newOperatorAddress}, ignoring.`)
                status.setRunning() // I guess?
            }
        } else {
            if (!community.operator || !community.operator.contract) {
                // abuse mitigation: only serve one community per event.address
                //   normally CommunityProduct shouldn't send several requests (potential spam attack attempt)
                this.error(`Too rapid OperatorChanged events from ${address}, community is still launching`)
                return
            }
            if (weShouldOperate) {
                this.log(`Repeated OperatorChanged("${newOperatorAddress}") event from ${address}`)
                return
            }

            // operator was changed, we can stop running the operator process
            // TODO: make sure the operator was in fact started first
            await community.operator.shutdown()
            delete communities[address]
        }
        // forward community start success/failure
        return isRunningPromise
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
        const address = getAddress(communityAddress)
        const contract = new Contract(address, CommunityProductJson.abi, this.eth)

        // throws if joinPartStreamId doesn't exist
        const joinPartStreamId = await contract.joinPartStream()
        const channel = new StreamrChannel(joinPartStreamId, this.operatorConfig.streamrWsUrl, this.operatorConfig.streamrHttpUrl)
        if (!await channel.isValid()) {
            throw new Error(`Faulty StreamrChannel("${joinPartStreamId}", "${this.operatorConfig.streamrWsUrl}", "${this.operatorConfig.streamrHttpUrl}")`)
        }

        return channel
    }

    /**
     * Create a state and block store for the community when operator is being created
     * Separated from startOperating to be better able to inject mocks in testing
     * @param {EthereumAddress} communityAddress of the community to be operated
     */
    async getStoreFor(communityAddress) {
        const address = getAddress(communityAddress)
        const storeDir = `${this.storeDir}/${address}`
        this.log(`Storing community ${communityAddress} data at ${storeDir}`)
        const fileStore = new FileStore(storeDir)
        return fileStore
    }

    async startOperating(communityAddress) {
        const address = getAddress(communityAddress)
        const contract = new Contract(address, CommunityProductJson.abi, this.eth)

        const operatorAddress = getAddress(await contract.operator())
        if (operatorAddress !== this.wallet.address) {
            // TODO: reconsider throwing here, since no way to *atomically* check operator before starting
            throw new Error(`startOperating: Community requesting operator ${operatorAddress}, not a job for me (${this.wallet.address})`)
        }

        const operatorChannel = await this.getChannelFor(address) // throws if joinPartStream doesn't exist
        const operatorStore = await this.getStoreFor(address)
        const config = Object.assign({}, this.operatorConfig, { contractAddress: address })
        const operator = new MonoplasmaOperator(this.wallet, operatorChannel, operatorStore)
        await operator.start(config)

        /* TODO: move start after adding community to this.communities, to enable seeing a "syncing" community
        const community = {
            state: "syncing",
        */
        const community = {
            state: "running",
            address,
            operator,
            joinPartStreamId: operatorChannel.stream.id,
        }
        this.communities[address] = community
        /*
        await operator.start(config)
        community.state = "running"
        */
        return community
    }
}
