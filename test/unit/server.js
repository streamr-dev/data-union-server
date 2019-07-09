const assert = require("assert")
const sleep = require("../../src/utils/sleep-promise")
const sinon = require("sinon")
const os = require("os")
const path = require("path")
const { Wallet, providers: { Web3Provider } } = require("ethers")

const ganache = require("ganache-core")

const mockStore = require("monoplasma/test/utils/mockStore")
const MockStreamrChannel = require("../utils/mockStreamrChannel")
const deployTestToken = require("../utils/deployTestToken")
const deployContract = require("../utils/deployCommunity")

const joinPartStreamName = "joinpart-server-test"
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
    let tokenAddress
    let wallet
    let server
    before(async function () {
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
        }))
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        console.log("Deploying test token...")
        tokenAddress = await deployTestToken(wallet)

        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test-${+new Date()}`)
        const config = {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        }
        server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel(wallet.privateKey, joinPartStreamName)
        await server.start()
    })

    after(async () => {
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
        assert(server.communities[contractAddress])
    })
})