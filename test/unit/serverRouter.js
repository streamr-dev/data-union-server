const os = require("os")
const path = require("path")
const express = require("express")
const bodyParser = require("body-parser")
const assert = require("assert")
const http = require("http")
const fetch = require("node-fetch")
const { Wallet, ContractFactory, providers: { Web3Provider } } = require("ethers")

const log = require("debug")("Streamr::dataunion::test::unit::server-router")

const DataUnionContract = require("../../build/DataunionVault")
const TokenContract = require("../../build/TestToken")

const ganache = require("ganache-core")

const until = require("../../src/utils/await-until")

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

const DataUnionServer = require("../../src/server")
const getServerRouter = require("../../src/routers/server")

// TODO: separate server router and dataunion router
describe("Data Union server router", () => {
    const port = 3031
    const serverURL = `http://localhost:${port}`

    let httpServer
    let token
    let dataUnion
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

        log("Deploying test token and dataUnion contract...")
        const tokenDeployer = new ContractFactory(TokenContract.abi, TokenContract.bytecode, wallet)
        token = await tokenDeployer.deploy("Router test token", "TEST")
        await token.deployed()

        const deployer = new ContractFactory(DataUnionContract.abi, DataUnionContract.bytecode, wallet)
        const contract = await deployer.deploy(wallet.address, "dummy-stream-id", token.address, 1000, 0)
        await contract.deployed()
        const contractAddress = contract.address

        log("Starting DataUnionServer...")
        const storeDir = path.join(os.tmpdir(), `dataUnionsRouter-test-${+new Date()}`)
        const server = new DataUnionServer(wallet, storeDir, {
            tokenAddress: token.address,
            operatorAddress: wallet.address,
        })
        channel = new MockStreamrChannel("dummy-stream-for-router-test")
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => channel
        dataUnion = await server.startOperating(contractAddress)

        log("Starting CommunitiesRouter...")
        const app = express()
        const router = getServerRouter(server)
        app.use(bodyParser.json())
        app.use(router)
        httpServer = http.createServer(app)
        httpServer.listen(port)
    })

    it("GET /", async () => {
        const resp = await fetch(`${serverURL}/dataunions`).then(res => res.json())
        assert.deepStrictEqual(resp, {
            config: {
                tokenAddress: "0x8688966AE53807c273D8B9fCcf667F0A0a91b1d3",
                operatorAddress: "0x8D7f03FdE1A626223364E592740a233b72395235"
            },
            dataunions: {
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
        const stats = await fetch(`${serverURL}/dataunions/${dataUnion.address}/stats`).then(res => res.json())
        assert.strictEqual(stats.memberCount.active, 2)
    })

    it("GET /members", async () => {
        const memberList = await fetch(`${serverURL}/dataunions/${dataUnion.address}/members`).then(res => res.json())
        assert.strictEqual(memberList.length, 2)
    })

    it("GET /members/address", async () => {
        const member = await fetch(`${serverURL}/dataunions/${dataUnion.address}/members/${members[0].address}`).then(res => res.json())
        assert.strictEqual(member.earnings, "50")
    })

    it("GET /members/non-existent-address", async () => {
        const res = await fetch(`${serverURL}/dataunions/${dataUnion.address}/members/0x0000000000000000000000000000000000000001`)
        assert.strictEqual(res.status, 404)
    })

    // Test the case where the member is in the data union but too new to have earnings in withdrawable blocks
    // Catch the UnhandledPromiseRejectionWarning: Error: Address 0x0000000000000000000000000000000000000002 not found!
    it("GET /members/new-member-address", async () => {
        const newMemberAddress = "0x0000000000000000000000000000000000000002"
        channel.publish("join", [newMemberAddress])
        await until(async () => {
            const memberList = await fetch(`${serverURL}/dataunions/${dataUnion.address}/members`).then(res => res.json())
            return memberList.length > 2
        })
        const member = await fetch(`${serverURL}/dataunions/${dataUnion.address}/members/${newMemberAddress}`).then(res => res.json())
        assert(!member.error)
        assert.strictEqual(member.withdrawableEarnings, "0")
    })

    after(() => {
        httpServer.close()
    })
})
