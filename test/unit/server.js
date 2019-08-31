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
const deployTestCommunity = require("../utils/deployTestCommunity")
const joinPartStreamId = "joinpart-server-test"
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

    before(async () => {
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
        }))
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        console.log("Deploying test token...")
        tokenAddress = await deployTestToken(wallet)
    })

    it("notices creation of a new CommunityProduct and starts Operator", async function () {
        this.timeout(100000)

        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test2-${+new Date()}`)
        const config = {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel(wallet.privateKey, joinPartStreamId)

        sinon.spy(server, "onOperatorChangedEventAt")
        sinon.spy(server, "startOperating")
        await server.start()
        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000)
        const contractAddress = contract.address

        // give ethers.js time to poll and notice the block, also for server to react
        await sleep(ganacheBlockIntervalSeconds * 1000)

        assert(server.onOperatorChangedEventAt.calledOnce)
        assert.strictEqual(contractAddress, server.onOperatorChangedEventAt.getCall(0).args[0])

        assert(server.startOperating.calledOnce)
        assert.strictEqual(contractAddress, server.startOperating.getCall(0).args[0])

        const clist = Object.keys(server.communities)
        assert.strictEqual(1, clist.length)
        assert(server.communities[contractAddress])

        await server.stop()
    })

    it("resumed operating communities it's operated before (e.g. a crash)", async function () {
        this.timeout(0)

        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test1-${+new Date()}`)
        const config = {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        }
        const server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => new MockStreamrChannel(wallet.privateKey, joinPartStreamId)
        await server.start()

        const contract = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000)
        console.log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestCommunity(wallet, wallet.address, tokenAddress, 1000)
        console.log(`Deployed contract at ${contract2.address}`)

        await contract2.setOperator("0x0000000000000000000000000000000000000001")

        await server.stop()

        await sleep(ganacheBlockIntervalSeconds * 1000)

        await server.start()
        assert(server.communities[contract.address])
        assert(!server.communities[contract2.address])
    })
})
