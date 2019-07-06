const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")
//const etherlime = require("etherlime")
const {
    Contract,
    utils: { parseEther },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrChannel = require("../../src/streamrChannel")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains, untilStreamMatches } = require("../utils/await-until")
const deployContract = require("../utils/deployCommunity")
const log = console.log  // () => {}

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const CommunityProduct = require("../../build/CommunityProduct.json")

const STREAMR_API_KEY = "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"
const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8546
const WEBSERVER_PORT = 3031
const BLOCK_FREEZE_SECONDS = 1

describe("Community product demo", () => {
    let operatorProcess
    //const admin = "0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8"

    it("should get through the happy path", async function () {
        this.timeout(30000)
        console.log("--- Running start_server.js ---")
        operatorProcess = spawn(process.execPath, ["start_server.js"], {
            env: {
                STORE_DIR,
                GANACHE_PORT,
                WEBSERVER_PORT,
                BLOCK_FREEZE_SECONDS,
                STREAMR_API_KEY,
                RESET: "yesplease",
                //QUIET: "shutup",
            }
        })
        operatorProcess.stdout.on("data", data => { console.log(`<server> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { console.log(`server *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { console.log(`start_server.js exited with code ${code}`) })
        operatorProcess.on("error", err => { console.log(`start_server.js ERROR: ${err}`) })

        const addressMatch = untilStreamMatches(operatorProcess.stdout, /<Ganache> \(0\) (0x[a-f0-9]{40}) \(~100 ETH\)/)
        const privateKeyMatch = untilStreamMatches(operatorProcess.stdout, /<Ganache> \(0\) (0x[a-f0-9]{64})/)
        const ganacheUrlMatch = untilStreamMatches(operatorProcess.stdout, /Listening on (.*)/)
        await untilStreamContains(operatorProcess.stdout, "[DONE]")
        const from = (await addressMatch)[1]
        const privateKey = (await privateKeyMatch)[1]
        const ganacheUrl = "http://" + (await ganacheUrlMatch)[1]

        console.log("--- Server started, getting the operator config ---")
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        console.log(config)

        console.log("1) Create a new Community product")

        console.log("1.1) Create joinPartStream")
        const channel = new StreamrChannel(STREAMR_API_KEY, `test-server-${+new Date()}`)
        channel.startServer()

        console.log("1.2) Deploy CommunityProduct contract")
        const ganacheProvider = new JsonRpcProvider(ganacheUrl)
        const wallet = new Wallet(privateKey, ganacheProvider)
        const communityAddress = await deployContract(wallet, config.operatorAddress, channel.joinPartStreamName, config.tokenAddress, BLOCK_FREEZE_SECONDS, log)

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
        await sleep(1000)   // TODO: better way to check?
        const res2 = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members`).then(resp => resp.json())
        console.log(`     Members after adding: ${JSON.stringify(res2)}`)
        const res2b = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/stats`).then(resp => resp.json())
        console.log(`     Stats after adding: ${JSON.stringify(res2b)}`)

        console.log("3) Send revenue in")
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            console.log("   Sending 10 tokens to CommunityProduct contract...")
            const tx = await token.transfer(communityAddress, parseEther("10"))
            await tx.wait(1)

            // TODO: things will break if revenue is added too fast. You can remove the below row to try and fix it.
            await sleep(500)

            // check total revenue
            const res3 = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/stats`).then(resp => resp.json())
            console.log(`   Total revenue: ${JSON.stringify(res3.totalEarnings)}`)
        }

        console.log("   Waiting for blocks to unfreeze...")
        await sleep(2000)

        console.log("4) Check tokens were distributed & withdraw")
        const res4 = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
        console.log(JSON.stringify(res4))

        const balanceBefore = await token.balanceOf(from)
        console.log(`   Token balance before: ${balanceBefore}`)

        const contract = new Contract(communityAddress, CommunityProduct.abi, wallet)
        await contract.withdrawAll(res4.withdrawableBlockNumber, res4.withdrawableEarnings, res4.proof)

        await sleep(500)
        const res4b = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityAddress}/members/${from}`).then(resp => resp.json())
        console.log(JSON.stringify(res4b))

        const balanceAfter = await token.balanceOf(from)
        console.log(`   Token balance after: ${balanceAfter}`)

        const difference = balanceAfter.sub(balanceBefore)
        console.log(`   Withdraw effect: ${difference}`)

        assert(difference.eq(parseEther("5")))
    })
    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.kill()
            operatorProcess = null
        }
    })

    after(() => {
        spawn("rm", ["-rf", STORE_DIR])
    })
})
