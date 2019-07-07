const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const {
    Contract,
    utils: { parseEther, formatEther },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrChannel = require("../../src/streamrChannel")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains, untilStreamMatches, capture } = require("../utils/await-until")
const deployContract = require("../utils/deployCommunity")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const CommunityProduct = require("../../build/CommunityProduct.json")

const STREAMR_API_KEY = "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"
const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8546
const WEBSERVER_PORT = 8080
const BLOCK_FREEZE_SECONDS = 1

describe("Community product demo", () => {
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
                STREAMR_API_KEY,
                RESET: "yesplease",
            }
        })
        //operatorProcess.stdout.on("data", data => { console.log(`<server> ${data.toString().trim()}`) })
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
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        console.log(config)

        console.log(`Moving 50 tokens to ${from} for testing...`)
        const ganacheProvider = new JsonRpcProvider(ganacheUrl)
        const adminPrivateKey = (await privateKeyMatch)[0]
        const adminWallet = new Wallet(adminPrivateKey, ganacheProvider)
        const adminToken = new Contract(config.tokenAddress, ERC20Mintable.abi, adminWallet)
        const adminTransferTx = await adminToken.transfer(from, parseEther("50"))
        await adminTransferTx.wait(2)

        console.log("1) Create a new Community product")

        console.log("1.1) Create joinPartStream")
        const channel = new StreamrChannel(STREAMR_API_KEY, `test-server-${+new Date()}`)
        channel.startServer()

        console.log("1.2) Deploy CommunityProduct contract")
        const wallet = new Wallet(privateKey, ganacheProvider)
        const communityAddress = await deployContract(wallet, config.operatorAddress, channel.joinPartStreamName, config.tokenAddress, BLOCK_FREEZE_SECONDS, console.log)

        console.log("1.3) Wait until Operator starts")
        let stats = { error: true }
        while (stats.error) {
            await sleep(100)
            stats = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/stats`).then(resp => resp.json())
        }
        console.log(`     Stats before adding: ${JSON.stringify(stats)}`)

        console.log("2) Add members")
        const userList = [from,
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
        channel.publish("join", userList)

        /* TODO: enable the members check after "realtime" state is implemented in watcher. Right now the members update only after block is created.
        let members = []
        while (members.length < 1) {
            await sleep(1000)
            members = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members`).then(resp => resp.json())
        }
        console.log(`     Members after adding: ${members}`)
        const res2b = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/stats`).then(resp => resp.json())
        console.log(`     Stats after adding: ${JSON.stringify(res2b)}`)
        assert(from in members)
        */

        console.log("3) Send revenue in")
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            const balance = await token.balanceOf(from)
            console.log(`   Sending 10 tokens (out of ${formatEther(balance)}) to CommunityProduct contract...`)

            const transferTx = await token.transfer(communityAddress, parseEther("10"))
            await transferTx.wait(2)

            // check total revenue
            const res3 = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/stats`).then(resp => resp.json())
            console.log(`   Total revenue: ${formatEther(res3.totalEarnings)}`)
        }

        console.log("   Waiting for blocks to unfreeze...") //... and also that state updates.
        // TODO: this really should work with much lower sleep time
        //   I think there's a mismatch in the router between which withdrawableBlock is reported and what the proof from state is
        await sleep(10000)

        console.log("4) Check tokens were distributed & withdraw")
        const res4 = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
        console.log(JSON.stringify(res4))

        const balanceBefore = await token.balanceOf(from)
        console.log(`   Token balance before: ${formatEther(balanceBefore)}`)

        const contract = new Contract(communityAddress, CommunityProduct.abi, wallet)
        const withdrawTx = await contract.withdrawAll(res4.withdrawableBlockNumber, res4.withdrawableEarnings, res4.proof)
        await withdrawTx.wait(2)

        const res4b = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
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
