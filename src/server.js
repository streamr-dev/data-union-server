const {
    Contract,
    utils: { id, getAddress, hexZeroPad, Interface }
} = require("ethers")

const debug = require("debug")
const pAll = require("p-all")

const FileStore = require("./fileStore")
const MonoplasmaOperator = require("./operator")
const StreamrChannel = require("./streamrChannel")

const DataUnionContract = require("../build/DataunionVault.json")

const { throwIfNotSet } = require("./utils/checkArguments")

const operatorChangedEventTopic = id("OperatorChanged(address)")
const operatorChangedAbi = ["event OperatorChanged(address indexed newOperator)"]
const operatorChangedInterface = new Interface(operatorChangedAbi)

/** This must be kept in sync with contracts/DataunionVault.sol */
const SERVER_VERSION = 1

/**
 * @typedef {string} EthereumAddress is hex string /0x[0-9A-Fa-f]^64/, return value from ethers.utils.getAddress
 */

/**
 * @property {Map<EthereumAddress, DataUnion>} dataUnions
 */
module.exports = class DataUnionServer {
    /**
     *
     * @param {Wallet} wallet from ethers.js
     */
    constructor(wallet, storeDir, operatorConfig, log, error) {
        throwIfNotSet(wallet, "Wallet argument to new DataUnionServer")
        throwIfNotSet(storeDir, "Store directory argument to new DataUnionServer")

        this.wallet = wallet
        this.eth = wallet.provider
        this.log = log || debug("Streamr::dataunion::server")   // TODO: don't pass log func in constructor
        this.error = error || console.error // eslint-disable-line no-console
        this.dataUnions = {}       // mapping: Ethereum address => dataUnion object
        this.storeDir = storeDir
        this.operatorConfig = operatorConfig || {}
        this.dataUnionIsRunningPromises = {}
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
        const dataUnions = this.dataUnions
        this.dataUnions = {}
        this.dataUnionIsRunningPromises = {}
        this.eth.removeAllListeners({ topics: [operatorChangedEventTopic] })
        await Promise.all(Object.values(dataUnions).map((dataUnion) => (
            dataUnion.operator && dataUnion.operator.shutdown()
        )))
    }

    async playbackPastOperatorChangedEvents() {
        //playback events of OperatorChanged(this wallet)
        const filter = {
            fromBlock: 1,
            toBlock: "latest",
            topics: [operatorChangedEventTopic, hexZeroPad(this.wallet.address, 32).toLowerCase()]
        }

        // TODO: remove dataUnions that have been switched away, so not to (start and) stop operators during playback

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
            this.log(`Playing back ${contractAddress} operator change event...`)
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
                this.log(`Played back ${contractAddress} operator change event.`)
                this.log(`Event ${numComplete} of ${total} processed in ${Date.now() - startEventTime}ms, ${Math.round((numComplete / total) * 100)}% complete.`)
            })
        }), { concurrency: 6 })

        this.log(`Finished playback of ${total} operator change events in ${Date.now() - startAllTime}ms.`)
        const numCommunities = Object.keys(this.dataUnions).length
        if (numErrors && numErrors === numCommunities) {
            // kill if all operators errored
            throw new Error(`All ${numCommunities} dataUnions failed to start. Shutting down.`)
        }
    }

    /** Check contract's version number, @returns {number} version number, or 0 if not found */
    async getVersionOfContractAt(address) {
        const contract = new Contract(address, DataUnionContract.abi, this.eth)
        if (!contract.version) { return 0 }
        return contract.version().then(v => v.toNumber()).catch(e => {
            // there is no version getter in the contract, return zero
            this.error(`Error message "${e.message}" calling version(). Method may not exist in old DU contract. Returning 0.`)
            return 0
        })
    }

    /**
     * Filter how to respond to OperatorChanged events, pass new dataUnions to startOperating
     * TODO: abuse defenses could be replaced with bytecode checking or similar if feasible
     * @param {string} address of Data Union that changed its operator
     */
    async onOperatorChangedEventAt(address) {
        const contract = new Contract(address, DataUnionContract.abi, this.eth)
        // create the promise to prevent later (duplicate) creation
        const isRunningPromise = this.dataUnionIsRunning(address)
        const status = this.dataUnionIsRunningPromises[address]
        const { dataUnions } = this
        const dataUnion = dataUnions[address]
        const newOperatorAddress = getAddress(await contract.operator())
        const contractVersion = await this.getVersionOfContractAt(address)
        const weShouldOperate = SERVER_VERSION === contractVersion && newOperatorAddress === this.wallet.address
        if (!dataUnion) {
            if (weShouldOperate) {
                // rapid event spam stopper (from one contract)
                dataUnions[address] = {
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
                    if (dataUnions[address]) {
                        dataUnions[address] = {
                            state: "failed",
                            error,
                            eventDetectedAt: dataUnions[address].eventDetectedAt,
                            failedAt: Date.now(),
                        }
                    }
                    status.setFailed(error)
                } else {
                    status.setRunning(result)
                }
            } else {
                this.log(`Detected a dataUnion for operator ${newOperatorAddress}, ignoring.`)
                status.setRunning() // I guess?
            }
        } else {
            if (!dataUnion.operator || !dataUnion.operator.contract) {
                // abuse mitigation: only serve one dataUnion per event.address
                //   normally DataUnion shouldn't send several requests (potential spam attack attempt)
                this.error(`Too rapid OperatorChanged events from ${address}, dataUnion is still launching`)
                return
            }
            if (weShouldOperate) {
                this.log(`Repeated OperatorChanged("${newOperatorAddress}") event from ${address}`)
                return
            }

            // operator was changed, we can stop running the operator process
            // TODO: make sure the operator was in fact started first
            await dataUnion.operator.shutdown()
            delete dataUnions[address]
        }
        // forward dataUnion start success/failure
        return isRunningPromise
    }

    /**
     * Helper function to await dataUnion deployments (after smart contract sent)
     * @param {EthereumAddress} address of the data union to watch
     * @returns {Promise} that resolves when dataUnion is successfully started, or fails if starting fails
     */
    async dataUnionIsRunning(address) {
        if (!(address in this.dataUnionIsRunningPromises)) {
            let setRunning, setFailed
            const promise = new Promise((done, fail) => {
                setRunning = done
                setFailed = fail
            })
            this.dataUnionIsRunningPromises[address] = {
                promise, setRunning, setFailed
            }
        }
        return this.dataUnionIsRunningPromises[address].promise
    }

    /**
     * Create a join/part channel for the data union when operator is being created
     * Separated from startOperating to be better able to inject mocks in testing
     * @param {EthereumAddress} dataUnionAddress of the data union to be operated
     */
    async getChannelFor(dataUnionAddress) {
        const address = getAddress(dataUnionAddress)
        const contract = new Contract(address, DataUnionContract.abi, this.eth)

        // throws if joinPartStreamId doesn't exist
        const joinPartStreamId = await contract.joinPartStream()
        const channel = new StreamrChannel(joinPartStreamId, this.operatorConfig.streamrWsUrl, this.operatorConfig.streamrHttpUrl)
        if (!await channel.isValid()) {
            throw new Error(`Faulty StreamrChannel("${joinPartStreamId}", "${this.operatorConfig.streamrWsUrl}", "${this.operatorConfig.streamrHttpUrl}")`)
        }

        return channel
    }

    /**
     * Create a state and block store for the data union when operator is being created
     * Separated from startOperating to be better able to inject mocks in testing
     * @param {EthereumAddress} dataUnionAddress of the data union to be operated
     */
    async getStoreFor(dataUnionAddress) {
        const address = getAddress(dataUnionAddress)
        const storeDir = `${this.storeDir}/${address}`
        this.log(`Storing data union ${dataUnionAddress} data at ${storeDir}`)
        const fileStore = new FileStore(storeDir)
        return fileStore
    }

    async startOperating(dataUnionAddress) {
        const address = getAddress(dataUnionAddress)
        const contract = new Contract(address, DataUnionContract.abi, this.eth)

        const operatorAddress = getAddress(await contract.operator())
        if (operatorAddress !== this.wallet.address) {
            // TODO: reconsider throwing here, since no way to *atomically* check operator before starting
            throw new Error(`startOperating: dataUnion requesting operator ${operatorAddress}, not a job for me (${this.wallet.address})`)
        }

        const operatorChannel = await this.getChannelFor(address) // throws if joinPartStream doesn't exist
        const operatorStore = await this.getStoreFor(address)
        const config = Object.assign({}, this.operatorConfig, { contractAddress: address })
        const operator = new MonoplasmaOperator(this.wallet, operatorChannel, operatorStore)
        await operator.start(config)

        /* TODO: move start after adding dataUnion to this.dataUnions, to enable seeing a "syncing" dataUnion
        const dataUnion = {
            state: "syncing",
        */
        const dataUnion = {
            state: "running",
            address,
            operator,
            joinPartStreamId: operatorChannel.stream.id,
        }
        this.dataUnions[address] = dataUnion
        /*
        await operator.start(config)
        dataUnion.state = "running"
        */
        return dataUnion
    }
}
