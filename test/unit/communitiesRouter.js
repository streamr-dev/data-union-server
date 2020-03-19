const os = require("os")
const path = require("path")
const express = require("express")
const bodyParser = require("body-parser")
const assert = require("assert")
const http = require("http")
const fetch = require("node-fetch")
const { Wallet, ContractFactory, providers: { Web3Provider } } = require("ethers")

const log = require("debug")("Streamr::CPS::test::unit::server-router")

const CommunityJson = require("../../build/CommunityProduct")
const TokenJson = require("../../build/TestToken")

const ganache = require("ganache-core")

const { until } = require("../utils/await-until")

const MockStreamrChannel = require("../utils/mockStreamrChannel")
const mockStore = require("../utils/mockStore")
const members = [
    { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: "50" },
    { address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", earnings: "20" },
]
const initialBlock = {
    blockNumber: 3,
    members,
    totalEarnings: 70,
    timestamp: Date.now(),
}
const startState = {
    lastBlockNumber: 5,
    lastPublishedBlock: {
        blockNumber: 3
    }
}

const CommunityProductServer = require("../../src/server")
const getServerRouter = require("../../src/routers/server")

describe("Community product server /communities router", () => {
    const port = 3031
    const serverURL = `http://localhost:${port}`

    let httpServer
    let token
    let community
    let channel
    before(async function() {
        this.timeout(5000)
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
        }))
        const wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        // "start from" block 10
        for (let i = 0; i < 10; i++) {
            await provider.send("evm_mine")
        }

        log("Deploying test token and Community contract...")
        const tokenDeployer = new ContractFactory(TokenJson.abi, TokenJson.bytecode, wallet)
        token = await tokenDeployer.deploy("Router test token", "TEST")
        await token.deployed()

        const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
        const contract = await deployer.deploy(wallet.address, "dummy-stream-id", token.address, 1000, 0)
        await contract.deployed()
        const contractAddress = contract.address

        log("Starting CommunityProductServer...")
        const storeDir = path.join(os.tmpdir(), `communitiesRouter-test-${+new Date()}`)
        const server = new CommunityProductServer(wallet, storeDir, {
            tokenAddress: token.address,
            operatorAddress: wallet.address,
        })
        channel = new MockStreamrChannel("dummy-stream-for-router-test")
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => channel
        community = await server.startOperating(contractAddress)

        log("Starting CommunitiesRouter...")
        const app = express()
        const router = getServerRouter(server)
        app.use(bodyParser.json())
        app.use(router)
        httpServer = http.createServer(app)
        httpServer.listen(port)
    })

    it("GET /", async () => {
        const resp = await fetch(`${serverURL}/communities`).then(res => res.json())
        assert.deepStrictEqual(resp, {
            config: {
                tokenAddress: "0x8688966AE53807c273D8B9fCcf667F0A0a91b1d3",
                operatorAddress: "0x8D7f03FdE1A626223364E592740a233b72395235"
            },
            communities: {
                "0xfb5755567e071663F2DA276aC1D6167B093f00f4": {
                    memberCount: { total: 2, active: 2, inactive: 0 },
                    totalEarnings: "70",
                    latestBlock: {
                        blockNumber: 0,
                        timestamp: 0,
                        memberCount: 0,
                        totalEarnings: 0
                    },
                    latestWithdrawableBlock: {
                        blockNumber: 0,
                        timestamp: 0,
                        memberCount: 0,
                        totalEarnings: 0
                    },
                    joinPartStreamId: "dummy-stream-for-router-test",
                    state: "running"
                }
            }
        })
    })

    it("GET /stats", async () => {
        const statsText = await fetch(`${serverURL}/communities/${community.address}/stats`).then(res => res.text())
        console.log(statsText)
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

    it("GET /members/non-existent-address", async () => {
        const res = await fetch(`${serverURL}/communities/${community.address}/members/0x0000000000000000000000000000000000000001`)
        assert.strictEqual(res.status, 404)
    })

    // Test the case where the member is in the community but too new to have earnings in withdrawable blocks
    // Catch the following:
    //   UnhandledPromiseRejectionWarning: Error: Address 0x0000000000000000000000000000000000000002 not found!
    //   at MerkleTree.getPath (node_modules/monoplasma/src/merkletree.js:121:19)
    //   at MonoplasmaState.getProof (node_modules/monoplasma/src/state.js:153:32)
    //   at MonoplasmaState.getMember (node_modules/monoplasma/src/state.js:129:26)
    //   at router.get (src/routers/communities.js:96:31)
    it("GET /members/new-member-address", async () => {
        const newMemberAddress = "0x0000000000000000000000000000000000000002"
        channel.publish("join", [newMemberAddress])
        await until(async () => {
            const memberList = await fetch(`${serverURL}/communities/${community.address}/members`).then(res => res.json())
            return memberList.length > 2
        })
        const member = await fetch(`${serverURL}/communities/${community.address}/members/${newMemberAddress}`).then(res => res.json())
        assert(!member.error)
        assert.strictEqual(member.withdrawableEarnings, "0")
    })

    after(() => {
        httpServer.close()
    })
})
