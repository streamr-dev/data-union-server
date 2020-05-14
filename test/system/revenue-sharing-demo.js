const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const log = require("debug")("Streamr::dataunion::test::system::operator-demo")

const {
    Contract,
    utils: { parseEther, formatEther },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains, untilStreamMatches, capture } = require("../utils/await-process-stream")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const MonoplasmaJson = require("../../build/Monoplasma.json")

const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8547
const WEBSERVER_PORT = 3030
const JOIN_PART_CHANNEL_PORT = 5964
const BLOCK_FREEZE_SECONDS = 1

const FileStore = require("../../src/fileStore")

// this is the oldest demo, presented in EthDenver 2019
// only one operator is run (no server.js), so only one dataUnion is being operated
describe("Revenue sharing demo", () => {
    let operatorProcess

    before(() => {
        log(`Creating store directory ${STORE_DIR}`)
        spawn("mkdir", ["-p", STORE_DIR])
    })

    after(() => {
        log(`Cleaning up store directory ${STORE_DIR}`)
        spawn("rm", ["-rf", STORE_DIR])
    })

    // TODO: fix start_operator.js, then fix this test (copy relevant improvements from data-union-demo first)
    it.skip("should get through the happy path", async function () {
        this.timeout(30000)
        log("--- Running start_operator.js ---")
        operatorProcess = spawn(process.execPath, ["start_operator.js"], {
            env: {
                STORE_DIR,
                GANACHE_PORT,
                WEBSERVER_PORT,
                JOIN_PART_CHANNEL_PORT,
                BLOCK_FREEZE_SECONDS,
                RESET: "yesplease",
            }
        })
        operatorProcess.stdout.on("data", data => { log(`<op> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { log(`op *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { log(`start_operator.js exited with code ${code}`) })
        operatorProcess.on("error", err => { log(`start_operator.js ERROR: ${err}`) })

        const addressMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{40}) \(~100 ETH\)/, 3)
        const privateKeyMatch = capture(operatorProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{64})/, 3)
        const ganacheUrlMatch = untilStreamMatches(operatorProcess.stdout, /Listening on (.*)/)
        await untilStreamContains(operatorProcess.stdout, "[DONE]")
        const from = (await addressMatch)[1]
        const privateKey = (await privateKeyMatch)[1]
        const ganacheUrl = "http://" + (await ganacheUrlMatch)[1]

        const ganacheProvider = new JsonRpcProvider(ganacheUrl)
        const wallet = new Wallet(privateKey, ganacheProvider)

        // TODO: get config from somewhere else
        log("--- Operator started, getting the init state ---")
        const fileStore = new FileStore()
        const state = await fileStore.loadState()

        log("state", state)
        const token = new Contract(state.tokenAddress, ERC20Mintable.abi, wallet)
        const contract = new Contract(state.contractAddress, MonoplasmaJson.abi, wallet)

        log(contract.contract.address)

        log("1) click 'Add users' button")
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
        const res1 = await fetch(`http://localhost:${WEBSERVER_PORT}/admin/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userList),
        }).then(resp => resp.json())
        log(`   Server response: ${JSON.stringify(res1)}`)

        log("   check that there are new users in dataUnion")
        const res1b = await fetch(`http://localhost:${WEBSERVER_PORT}/api/status`).then(resp => resp.json())
        log(`      Status: ${JSON.stringify(res1b)}`)

        log("2) click 'Add revenue' button a couple times")
        for (let i = 0; i < 5; i++) {
            log("   Sending 10 tokens to Monoplasma contract...")
            await token.transfer(contract.contract.address, parseEther("10"))

            // TODO: things will break if revenue is added too fast. You can remove the below row to try and fix it.
            await sleep(5000)

            // check total revenue
            const res2 = await fetch(`http://localhost:${WEBSERVER_PORT}/api/status`).then(resp => resp.json())
            log(`   Total revenue: ${formatEther(res2.totalEarnings)}`)
        }

        log("   Waiting for blocks to unfreeze...")
        await sleep(2000)

        log("3) click 'View' button")
        const res3 = await fetch(`http://localhost:${WEBSERVER_PORT}/api/members/${from}`).then(resp => resp.json())
        log(res3)

        const balanceBefore = await token.balanceOf(from)
        log(`   Token balance before: ${formatEther(balanceBefore)}`)

        log("4) click 'Withdraw' button")
        await contract.withdrawAll(res3.withdrawableBlockNumber, res3.withdrawableEarnings, res3.proof)

        // check that we got the tokens
        const balanceAfter = await token.balanceOf(from)
        log(`   Token balance after: ${formatEther(balanceAfter)}`)

        const difference = balanceAfter.sub(balanceBefore)
        log(`   Withdraw effect: ${formatEther(difference)}`)

        assert(difference.eq(parseEther("5")))
    })

    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.kill()
            operatorProcess = null
        }
    })
})
