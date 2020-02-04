const assert = require("assert")
const sleep = require("../../src/utils/sleep-promise")
const sinon = require("sinon")
const os = require("os")
const path = require("path")
const { Wallet, providers: { Web3Provider } } = require("ethers")

const log = require("debug")("Streamr::CPS::test::unit::server")

const ganache = require("ganache-core")

const mockStore = require("monoplasma/test/utils/mockStore")
const MockStreamrChannel = require("../utils/mockStreamrChannel")
const deployTestToken = require("../utils/deployTestToken")
const deployTestCommunity = require("../utils/deployTestCommunity")
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
    lastPublishedBlock: {
        blockNumber: 3
    }
}

const CommunityProductServer = require("../../src/server")
describe("CommunityProductServer", function () {
    this.timeout(10000)
    let tokenAddress
    let wallet

    before(async () => {
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
        }))
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        log("Deploying test token...")
        tokenAddress = await deployTestToken(wallet)
    })

    afterEach(() => {
        sinon.restore()
    })

    it("notices creation of a new CommunityProduct and starts Operator", async function () {
        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test2-${+new Date()}`)
        const config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel("dummy-stream-id")

        sinon.spy(server, "onOperatorChangedEventAt")
        sinon.spy(server, "startOperating")
        await server.start()
        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        const contractAddress = contract.address

        // give ethers.js time to poll and notice the block, also for server to react
        await sleep(ganacheBlockIntervalSeconds * 1000)

        // Note: this test must run first for the below position-sensitive assertions to pass
        assert(server.onOperatorChangedEventAt.calledOnce)
        assert.strictEqual(contractAddress, server.onOperatorChangedEventAt.getCall(0).args[0])

        assert(server.startOperating.calledOnce)
        assert.strictEqual(contractAddress, server.startOperating.getCall(0).args[0])

        const clist = Object.keys(server.communities)
        assert.strictEqual(1, clist.length)
        assert(server.communities[contractAddress])

        await server.stop()
    })

    it("stops operators when server is stopped", async function () {
        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test2-${+new Date()}`)
        const config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel("dummy-stream-id")
        await server.start()
        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        await server.communityIsRunning(contract.address)

        // give ethers.js time to poll and notice the block, also for server to react
        await sleep(ganacheBlockIntervalSeconds * 1000)

        const { communities } = server
        assert(Object.keys(communities), "has at least 1 community")

        await server.stop()

        assert.equal(Object.keys(server.communities).length, 0, "server.communities is empty after stop")
        Object.values(communities).forEach((community) => {
            assert.ok(community.operator.watcher.channel.isClosed())
        })
    })

    it("resumed operating communities it's operated before (e.g. a crash)", async function () {
        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test1-${+new Date()}`)
        const config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel("dummy-stream-id")
        await server.start()

        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await contract2.setOperator("0x0000000000000000000000000000000000000001")

        await server.stop()

        await sleep(ganacheBlockIntervalSeconds * 1000)

        await server.start()
        assert(server.communities[contract.address])
        assert(!server.communities[contract2.address])
    })

    it("will not fail to start if there is an error playing back a community", async function () {
        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test1-${+new Date()}`)
        const config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        sinon.stub(server, "getStoreFor").callsFake(() => mockStore(startState, initialBlock, log))
        sinon.stub(server, "getChannelFor").callsFake(() => new MockStreamrChannel("dummy-stream-id"))

        await server.start()

        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await server.communityIsRunning(contract.address)
        await server.communityIsRunning(contract2.address)
        log("Communities running")

        await server.stop()
        await sleep(ganacheBlockIntervalSeconds * 1000)

        // force one community startup to fail when getting channel
        server.getChannelFor.withArgs(contract.address).callsFake(async function () {
            throw new Error("expected fail")
        })
        await assert.doesNotReject(() => server.start())
        await server.stop()
    })

    it("will fail to start if there is an error playing back all communities", async function () {
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test1-${+new Date()}`)
        const config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        sinon.stub(server, "getStoreFor").callsFake(() => mockStore(startState, initialBlock, log))
        sinon.stub(server, "getChannelFor").callsFake(() => new MockStreamrChannel("dummy-stream-id"))

        await server.start()

        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await server.stop()
        await sleep(ganacheBlockIntervalSeconds * 1000)

        server.getChannelFor.callsFake(async function () {
            throw new Error("expected fail")
        })
        assert.rejects(() => server.start())
    })
})
