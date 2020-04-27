const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const log = require("debug")("Streamr::dataunion::test::system::localhost")

const {
    Contract,
    utils: { parseEther, formatEther, getAddress },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrChannel = require("../../src/streamrChannel")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains, untilStreamMatches, capture } = require("../utils/await-until")
const deployContract = require("../../src/utils/deployContract")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const DataUnion = require("../../build/DataunionVault")

const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8548
const WEBSERVER_PORT = 8085//8880
const BLOCK_FREEZE_SECONDS = 1
const ADMIN_FEE = 0

const { streamrWs, streamrHttp, streamrNodeAddress } = require("../CONFIG")

/**
 * This test is an "integration test" but the setup should still be such that it could be independently run
 *   against production simply by not providing STREAMR_WS_URL and STREAMR_HTTP_URL (that will point to dev
 *   docker in Travis test), hence spin up an "internal" ganache for the test
 *
 * Point of view is of Data Unions developer
 */
describe("Data Union demo", () => {
    let operatorProcess

    before(async () => {
        log(`Creating store directory ${STORE_DIR}`)
        spawn("mkdir", ["-p", STORE_DIR])
        await sleep(100)
    })

    after(async () => {
        log(`Cleaning up store directory ${STORE_DIR}`)
        spawn("rm", ["-rf", STORE_DIR])
        await sleep(100)
    })

    async function startServer() {
        log("--- Running start_server.js ---")
        operatorProcess = spawn(process.execPath, ["scripts/start_server.js"], {
            env: {
                STREAMR_WS_URL: streamrWs,
                STREAMR_HTTP_URL: streamrHttp,
                STORE_DIR,
                GANACHE_PORT,
                WEBSERVER_PORT,
                BLOCK_FREEZE_SECONDS,
                RESET: "yesplease",
            }
        })
        operatorProcess.stdout.on("data", data => { log(`<server> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { log(`server *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { log(`start_server.js exited with code ${code}`) })
        operatorProcess.on("error", err => { log(`start_server.js ERROR: ${err}`) })

        const addressMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{40}) \(~100 ETH\)/, 3)
        const privateKeyMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{64})/, 3)
        const ganacheUrlMatch = untilStreamMatches(operatorProcess.stdout, /Listening on (.*)/)
        await untilStreamContains(operatorProcess.stdout, "[DONE]")
        const address = getAddress((await addressMatch)[1])
        const privateKey = (await privateKeyMatch)[1]
        const ganacheUrl = "http://" + (await ganacheUrlMatch)[1]

        const ganacheProvider = new JsonRpcProvider(ganacheUrl)
        const adminPrivateKey = (await privateKeyMatch)[0]

        return {
            ganacheProvider,
            adminPrivateKey,
            privateKey,
            address,
        }
    }

    // for pre-started server, so to be able to debug also the server while running tests
    async function connectToLocalGanache() {    //eslint-disable-line no-unused-vars
        return {
            ganacheProvider: new JsonRpcProvider("http://localhost:8545"),
            adminPrivateKey: "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",  // ganache 0
            privateKey: "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // ganache 1
            address: "0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0",
        }
    }

    it("should get through the happy path", async function () {
        this.timeout(5 * 60 * 1000)

        const {
            ganacheProvider,
            adminPrivateKey,
            privateKey,
            address,
        } = await startServer()
        //} = await connectToLocalGanache()

        log("--- Server started, getting the operator config ---")
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        log(config)

        log(`Moving 50 tokens to ${address} for testing...`)
        const adminWallet = new Wallet(adminPrivateKey, ganacheProvider)
        const adminToken = new Contract(config.tokenAddress, ERC20Mintable.abi, adminWallet)
        const adminTransferTx = await adminToken.transfer(address, parseEther("50"))
        await adminTransferTx.wait(2)

        log("1) Create a new data union product")

        log("1.1) Create joinPartStream")  // done in deploydataUnion function below
        log("1.2) Deploy data union contract")
        const wallet = new Wallet(privateKey, ganacheProvider)
        const nodeAddress = getAddress(streamrNodeAddress)
        const dataUnionContract = await deployContract(wallet, config.operatorAddress, config.tokenAddress, nodeAddress, BLOCK_FREEZE_SECONDS, ADMIN_FEE, config.streamrWsUrl, config.streamrHttpUrl)
        const dataUnionAddress = dataUnionContract.address

        log("1.3) Wait until Operator starts")
        let stats = { error: true }
        while (stats.error) {
            await sleep(100)
            stats = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/stats`).then(resp => resp.json())
        }
        log(`     Stats before adding: ${JSON.stringify(stats)}`)

        log("2) Add members")
        const userList = [address,
            "0xeabe498c90fb31f6932ab9da9c4997a6d9f18639",
            "0x4f623c9ef67b1d9a067a8043344fb80ae990c734",
            "0xbb0965a38fcd97b6f34b4428c4bb32875323e012",
            "0x6dde58bf01e320de32aa69f6daf9ba3c887b4db6",
            "0xe04d3d361eb88a67a2bd3a4762f07010708b2811",
            "0x47262e0936ec174b7813941ee57695e3cdcd2043",
            "0xb5fe12f7437dbbc65c53bc9369db133480438f6f",
            "0x3ea97ad9b624acd8784011c3ebd0e07557804e45",
            "0x4d4bb0980c214b8f4e24d7d58ccf5f8a92f70d76",
        ]
        const joinPartStreamId = await dataUnionContract.joinPartStream()
        const channel = new StreamrChannel(joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)
        await channel.startServer(privateKey)
        channel.publish("join", userList)

        let members = []
        while (members.length < 1) {
            await sleep(1000)
            members = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/members`).then(resp => resp.json())
        }
        const memberAddresses = members.map(m => m.address)
        log(`     Members after adding: ${memberAddresses}`)
        const res2b = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/stats`).then(resp => resp.json())
        log(`     Stats after adding: ${JSON.stringify(res2b)}`)
        assert(memberAddresses.includes(address))

        log("3) Send revenue in")
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            const balance = await token.balanceOf(address)
            log(`   Sending 10 tokens (out of remaining ${formatEther(balance)}) to DataUnion contract...`)

            const transferTx = await token.transfer(dataUnionAddress, parseEther("10"))
            await transferTx.wait(2)

            // check total revenue
            const res3 = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/stats`).then(resp => resp.json())
            log(`   Total revenue: ${formatEther(res3.totalEarnings)}`)
        }

        log("   Waiting for blocks to unfreeze...") //... and also that state updates.
        // TODO: this really should work with much lower sleep time
        //   I think there's a mismatch in the router between which withdrawableBlock is reported and what the proof from state is
        await sleep(10000)

        log("4) Check tokens were distributed & withdraw")
        const res4 = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/members/${address}`).then(resp => resp.json())
        log(JSON.stringify(res4))

        const balanceBefore = await token.balanceOf(address)
        log(`   Token balance before: ${formatEther(balanceBefore)}`)

        const contract = new Contract(dataUnionAddress, DataUnion.abi, wallet)
        const withdrawTx = await contract.withdrawAll(res4.withdrawableBlockNumber, res4.withdrawableEarnings, res4.proof)
        await withdrawTx.wait(2)

        const res4b = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${dataUnionAddress}/members/${address}`).then(resp => resp.json())
        log(JSON.stringify(res4b))

        const balanceAfter = await token.balanceOf(address)
        log(`   Token balance after: ${formatEther(balanceAfter)}`)

        const difference = balanceAfter.sub(balanceBefore)
        log(`   Withdraw effect: ${formatEther(difference)}`)

        assert.strictEqual(difference.toString(), parseEther("5").toString())   // incl admin fee?
    })

    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.kill()
            operatorProcess = null
        }
    })
})
