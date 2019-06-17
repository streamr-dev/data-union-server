const assert = require("assert")
const sleep = require("../../src/utils/sleep-promise")
const sinon = require("sinon")
const os = require("os")
const path = require("path")
const { Wallet, providers: { JsonRpcProvider } } = require("ethers")

const startGanache = require("monoplasma/src/utils/startGanache")
const mockStore = require("monoplasma/test/utils/mockStore")
const MockStreamrChannel = require("../utils/mockStreamrChannel")
const deployTestToken = require("../utils/deployTestToken")
const deployContract = require("../utils/deployCommunity")

const joinPartStreamName = "joinpart-server-test"
const apiKey = "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"
const ganacheBlockIntervalSeconds = 4
const members = [
    { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: "50" },
    { address: "0xb3428050ea2448ed2e4409be47e1a50ebac0b2d2", earnings: "20" },
]
const initialBlock = {
    blockNumber: 3,
    members,
    totalEarnings: 70,
}
const startState = {
    lastBlockNumber: 5,
    lastPublishedBlock: 3,
}

const logs = []
const log = (...args) => {
    console.log(...args)
    logs.push(args)
}

const CommunityProductServer = require("../../src/server")
describe("CommunityProductServer", () => {
    let ganache
    let tokenAddress
    let wallet
    let server
    before(async function () {
        this.timeout(100000)
        const ganacheLog = () => {} // msg => { log(" <Ganache> " + msg) }
        ganache = await startGanache(8263, ganacheLog, ganacheLog, ganacheBlockIntervalSeconds)
        const provider = new JsonRpcProvider(ganache.httpUrl)
        wallet = new Wallet(ganache.privateKeys[0], provider)
        const network = await provider.getNetwork()
        console.log(`Deploying test token and Community contract (network id = ${network.chainId})...`)
        tokenAddress = await deployTestToken(wallet)
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test-${+new Date()}`)
        const config = {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        }
        server = new CommunityProductServer(wallet, apiKey, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel(apiKey, joinPartStreamName)
        await server.start()
    })

    after(async () => {
        ganache.shutdown()
        await server.stop()
    })

    it("notices creation of a new CommunityProduct and starts Operator", async function () {
        this.timeout(100000)
        sinon.spy(server, "onOperatorChangedEventAt")
        sinon.spy(server, "startOperating")
        const contractAddress = await deployContract(wallet, wallet.address, joinPartStreamName, tokenAddress, 1000)

        // give ethers.js time to poll and notice the block, also for server to react
        await sleep(ganacheBlockIntervalSeconds * 1000)

        assert(server.onOperatorChangedEventAt.calledOnce)
        assert.strictEqual(contractAddress, server.onOperatorChangedEventAt.getCall(0).args[0])

        assert(server.startOperating.calledOnce)
        assert.strictEqual(contractAddress, server.startOperating.getCall(0).args[0])

        const clist = Object.keys(server.communities)
        assert.strictEqual(1, clist.length)
        assert.strictEqual(apiKey, server.communities[contractAddress].apiKey)
    })
})