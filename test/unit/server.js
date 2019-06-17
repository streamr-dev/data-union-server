const assert = require("assert")
const sleep = require("../../src/utils/sleep-promise")
const sinon = require("sinon")
const os = require("os")
const path = require("path")
const { Wallet, providers: { JsonRpcProvider } } = require("ethers")

const deployTestToken = require("../utils/deployTestToken")
const deployContract = require("../utils/deployCommunity")
const startGanache = require("monoplasma/src/utils/startGanache")

const MockChannel = require("monoplasma/test/utils/mockChannel")
const mockChannel = new MockChannel()
const mockStore = require("monoplasma/test/utils/mockStore")
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
const joinPartStreamId = "joinpart"

const CommunityProductServer = require("../../src/server")

const logs = []
const log = msg => {
    console.log(msg)
    logs.push(msg)
}

describe("CommunityProductServer", () => {
    let ganache
    let tokenAddress
    let wallet
    let server
    before(async function () {
        this.timeout(100000)
        const ganacheLog = msg => { log(" <Ganache> " + msg) }
        ganache = await startGanache(8263, ganacheLog, ganacheLog, 4)
        const provider = new JsonRpcProvider(ganache.httpUrl)
        wallet = new Wallet(ganache.privateKeys[0], provider)
        const network = await provider.getNetwork()
        console.log(`Deploying test token and Community contract (network id = ${network})...`)
        tokenAddress = await deployTestToken(wallet)
        const apiKey = "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test-${+new Date()}`)
        const config = {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        }
        server = new CommunityProductServer(wallet, apiKey, storeDir, config, log, log)
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => mockChannel
        await server.start()
    })

    after(async () => {
        ganache.shutdown()
        await server.stop()
    })

    it("notices creation of a new CommunityProduct", async function () {
        this.timeout(100000)
        sinon.spy(server, "onOperatorChangedEventAt")
        //await sleep(1000)
        const contractAddress = await deployContract(wallet, wallet.address, joinPartStreamId, tokenAddress, 1000)
        await sleep(4000)
        assert(server.onOperatorChangedEventAt.calledOnce)
        assert.strictEqual(contractAddress, server.onOperatorChangedEventAt.getCall(0).args[0])
    })
})