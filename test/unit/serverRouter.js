const os = require("os")
const path = require("path")
const express = require("express")
const bodyParser = require("body-parser")
const assert = require("assert")
const http = require("http")
const fetch = require("node-fetch")
const { Wallet, ContractFactory, providers: { Web3Provider } } = require("ethers")

const CommunityJson = require("../../build/CommunityProduct")
const TokenJson = require("../../build/TestToken")

const ganache = require("ganache-core")

//const { until } = require("../utils/await-until")

const MockStreamrChannel = require("../utils/mockStreamrChannel")
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
        const token = await tokenDeployer.deploy("Router test token", "TEST")
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
        const channel = new MockStreamrChannel(secretKey, "dummy-stream-for-router-test")
        server.getStoreFor = () => mockStore(startState, initialBlock, log)
        server.getChannelFor = () => channel
        const router = getServerRouter(server, log)
        await server.startOperating(contractAddress)

        log("Starting ServerRouter...")
        const app = express()
        app.use(bodyParser.json())
        app.use("/", router)
        httpServer = http.createServer(app)
        httpServer.listen(port)
    })

    it("GET /summary", async () => {
        const resp = await fetch(`${serverURL}/summary`).then(res => res.json())
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

    after(() => {
        httpServer.close()
    })
})
