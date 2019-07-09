const os = require("os")
const path = require("path")
const express = require("express")
const bodyParser = require("body-parser")
const assert = require("assert")
const http = require("http")
const fetch = require("node-fetch")
const { Wallet, providers: { Web3Provider } } = require("ethers")

const deployTestToken = require("../utils/deployTestToken")
const deployContract = require("../utils/deployCommunity")
const ganache = require("ganache-core")

const MockChannel = require("monoplasma/test/utils/mockChannel")
const mockChannel = new MockChannel()
const mockStore = require("monoplasma/test/utils/mockStore")
const log = console.log  // () => {}
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
const getCommunitiesRouter = require("../../src/routers/communities")

describe("Community product server /communities router", () => {
    const port = 3031
    const serverURL = `http://localhost:${port}`

    let httpServer
    let tokenAddress
    let community
    before(async function() {
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
        }))
        const wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        log("Deploying test token and Community contract...")
        tokenAddress = await deployTestToken(wallet)
        const contractAddress = await deployContract(wallet, wallet.address, joinPartStreamId, tokenAddress, 1000)

        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test-${+new Date()}`)
        const server = new CommunityProductServer(wallet, storeDir, {
            tokenAddress,
            defaultReceiverAddress: wallet.address,
            operatorAddress: wallet.address,
        })
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => mockChannel
        const router = getCommunitiesRouter(server)
        community = await server.startOperating(contractAddress)
        //mockChannel.publish("join", [])

        log("Starting CommunitiesRouter...")
        const app = express()
        app.use(bodyParser.json())
        app.use("/communities", router)
        httpServer = http.createServer(app)
        httpServer.listen(port)
    })

    it("GET /", async () => {
        const resp = await fetch(`${serverURL}/communities/${community.address}`).then(res => res.json())
        assert.strictEqual(resp.status, "ok")
    })

    it("GET /stats", async () => {
        const stats = await fetch(`${serverURL}/communities/${community.address}/stats`).then(res => res.json())
        assert.strictEqual(stats.memberCount.active, 2)
    })

    it("GET /members", async () => {
        const memberList = await fetch(`${serverURL}/communities/${community.address}/members`).then(res => res.json())
        assert.strictEqual(memberList.length, 2)
    })

    it("GET /members/address", async () => {
        const member = await fetch(`${serverURL}/communities/${community.address}/members/${members[0].address}`).then(res => res.json())
        assert.strictEqual(member.earnings, "50")
    })

    after(() => {
        httpServer.close()
    })
})
