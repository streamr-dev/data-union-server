const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const {
    Contract,
    utils: { parseEther, formatEther },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains, untilStreamMatches, capture } = require("../utils/await-until")
const deployContract = require("../../src/deployCommunity")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const CommunityProduct = require("../../build/CommunityProduct.json")

const EE_URL = process.env.EE_URL || "http://localhost:8081/streamr-core"
const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8546
const WEBSERVER_PORT = 8080
const BLOCK_FREEZE_SECONDS = 1

// more end-to-end than community-product-demo.js because it pokes the stream and server directly
//   this test only talks to E&E
describe("Community product demo but through a running E&E instance", () => {
    let operatorProcess

    before(() => {
        console.log(`Creating store directory ${STORE_DIR}`)
        spawn("mkdir", ["-p", STORE_DIR])
    })

    after(() => {
        console.log(`Cleaning up store directory ${STORE_DIR}`)
        spawn("rm", ["-rf", STORE_DIR])
    })

    it("should get through the happy path", async function () {
        this.timeout(5 * 60 * 1000)

        console.log("--- Running start_server.js ---")
        operatorProcess = spawn(process.execPath, ["start_server.js"], {
            env: {
                STORE_DIR,
                GANACHE_PORT,
                WEBSERVER_PORT,
                BLOCK_FREEZE_SECONDS,
                RESET: "yesplease",
            }
        })
        operatorProcess.stdout.on("data", data => { console.log(`<server> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { console.log(`server *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { console.log(`start_server.js exited with code ${code}`) })
        operatorProcess.on("error", err => { console.log(`start_server.js ERROR: ${err}`) })

        const addressMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{40}) \(~100 ETH\)/, 3)
        const privateKeyMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{64})/, 3)
        const ganacheUrlMatch = untilStreamMatches(operatorProcess.stdout, /Listening on (.*)/)
        await untilStreamContains(operatorProcess.stdout, "[DONE]")
        const from = (await addressMatch)[1]
        const privateKey = (await privateKeyMatch)[1]
        const ganacheUrl = "http://" + (await ganacheUrlMatch)[1]

        console.log("--- Server started, getting the operator config ---")
        // TODO: eliminate direct server communication (use /stats? Change EE?)
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        console.log(config)

        console.log(`Moving 50 tokens to ${from} for testing...`)
        const ganacheProvider = new JsonRpcProvider(ganacheUrl)
        const adminPrivateKey = (await privateKeyMatch)[0]
        const adminWallet = new Wallet(adminPrivateKey, ganacheProvider)
        const adminToken = new Contract(config.tokenAddress, ERC20Mintable.abi, adminWallet)
        const adminTransferTx = await adminToken.transfer(from, parseEther("50"))
        await adminTransferTx.wait(2)

        // TODO: create a stream that's going to go into the product
        const streamId = ""

        console.log("1) Create a new Community product")

        console.log("1.1) Create joinPartStream")
        const joinPartStreamName = "community-product-e2e-test-" + Date.now()
        const joinPartStream = await this.client.getOrCreateStream({
            name: joinPartStreamName,
            public: true,
        })

        console.log("1.2) Create the product on the marketplace")
        const product = {
            "name": "Community Product server test product " + Date.now(),
            "description": "PLEASE DELETE ME, I'm a Community Product server test product",
            "imageUrl": "https://www.streamr.com/uploads/to-the-moon.png",
            "category": "test-category-id",
            "streams": [ streamId ],
            "previewStream": streamId,
            "previewConfigJson": "string",
            "ownerAddress": from,
            "beneficiaryAddress": from,
            "pricePerSecond": 5,
            "priceCurrency": "DATA",
            "minimumSubscriptionInSeconds": 0,
            type: "community",
        }
        const productCreateResponse = await fetch(`${EE_URL}}/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(product),
        }).then(resp => resp.json())
        console.log(`     Response: ${JSON.stringify(productCreateResponse)}`)

        console.log("1.3) Deploy CommunityProduct contract")
        const wallet = new Wallet(privateKey, ganacheProvider)
        const communityAddress = await deployContract(wallet, config.operatorAddress, joinPartStream.id, config.tokenAddress, BLOCK_FREEZE_SECONDS, console.log, config.streamrWsUrl, config.streamrHttpUrl)

        console.log("1.4) Wait until Operator starts")
        let stats = { error: true }
        while (stats.error) {
            await sleep(100)
            stats = await fetch(`${EE_URL}}/communities/${communityAddress}/stats`).then(resp => resp.json())
        }
        console.log(`     Stats before adding: ${JSON.stringify(stats)}`)

        console.log("2) Add members")
        // TODO: await fetch(`${EE_URL}/communities/${communityAddress}/members`).then(resp => resp.json())

        console.log("3) Send revenue in")
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            const balance = await token.balanceOf(from)
            console.log(`   Sending 10 tokens (out of ${formatEther(balance)}) to CommunityProduct contract...`)

            const transferTx = await token.transfer(communityAddress, parseEther("10"))
            await transferTx.wait(2)

            // check total revenue
            const res3 = await fetch(`${EE_URL}/communities/${communityAddress}/stats`).then(resp => resp.json())
            console.log(`   Total revenue: ${formatEther(res3.totalEarnings)}`)
        }

        console.log("   Waiting for blocks to unfreeze...") //... and also that state updates.
        // TODO: this really should work with much lower sleep time
        //   I think there's a mismatch in the router between which withdrawableBlock is reported and what the proof from state is
        await sleep(10000)

        console.log("4) Check tokens were distributed & withdraw")
        const res4 = await fetch(`${EE_URL}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
        console.log(JSON.stringify(res4))

        const balanceBefore = await token.balanceOf(from)
        console.log(`   Token balance before: ${formatEther(balanceBefore)}`)

        const contract = new Contract(communityAddress, CommunityProduct.abi, wallet)
        const withdrawTx = await contract.withdrawAll(res4.withdrawableBlockNumber, res4.withdrawableEarnings, res4.proof)
        await withdrawTx.wait(2)

        const res4b = await fetch(`${EE_URL}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
        console.log(JSON.stringify(res4b))

        const balanceAfter = await token.balanceOf(from)
        console.log(`   Token balance after: ${formatEther(balanceAfter)}`)

        const difference = balanceAfter.sub(balanceBefore)
        console.log(`   Withdraw effect: ${formatEther(difference)}`)

        assert(difference.eq(parseEther("5")))
    })

    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.kill()
            operatorProcess = null
        }
    })
})
