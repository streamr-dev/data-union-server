const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains } = require("../utils/await-until")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const MonoplasmaJson = require("../../build/Monoplasma.json")
const etherlime = require("etherlime")
const ethers = require("ethers")

const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8545
const WEBSERVER_PORT = 3030
const JOIN_PART_CHANNEL_PORT = 5964
const BLOCK_FREEZE_SECONDS = 1

const from = "0xd9995bae12fee327256ffec1e3184d492bd94c31"

const { loadState } = require("monoplasma/src/fileStore")(STORE_DIR)

describe("Revenue sharing demo", () => {
    let operatorProcess
    //const admin = "0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8"

    it("should get through the happy path", async function () {
        this.timeout(30000)
        console.log("--- Running start_operator.js ---")
        operatorProcess = spawn(process.execPath, ["start_operator.js"], {
            env: {
                STORE_DIR,
                GANACHE_PORT,
                WEBSERVER_PORT,
                JOIN_PART_CHANNEL_PORT,
                BLOCK_FREEZE_SECONDS,
                RESET: "yesplease",
                //QUIET: "shutup",      // TODO: this makes start_operator.js not return in time... weird
            }
        })
        operatorProcess.stdout.on("data", data => { console.log(`<op> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { console.log(`op *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { console.log(`start_operator.js exited with code ${code}`) })
        operatorProcess.on("error", err => { console.log(`start_operator.js ERROR: ${err}`) })

        await untilStreamContains(operatorProcess.stdout, "[DONE]")

        console.log("--- Operator started, getting the init state ---")
        const state = await loadState()

        console.log("state", state)
        const token = await etherlime.ContractAt(ERC20Mintable, state.tokenAddress)
        const contract = await etherlime.ContractAt(MonoplasmaJson, state.contractAddress)

        console.log(contract.contract.address)

        console.log("1) click 'Add users' button")
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
        console.log(`   Server response: ${JSON.stringify(res1)}`)

        console.log("   check that there are new users in community")
        const res1b = await fetch(`http://localhost:${WEBSERVER_PORT}/api/status`).then(resp => resp.json())
        console.log(`      Status: ${JSON.stringify(res1b)}`)

        console.log("2) click 'Add revenue' button a couple times")
        for (let i = 0; i < 5; i++) {
            console.log("   Sending 10 tokens to Monoplasma contract...")
            await token.transfer(contract.contract.address, ethers.utils.parseEther("10"))

            // TODO: things will break if revenue is added too fast. You can remove the below row to try and fix it.
            await sleep(5000)

            // check total revenue
            const res2 = await fetch(`http://localhost:${WEBSERVER_PORT}/api/status`).then(resp => resp.json())
            console.log(`   Total revenue: ${JSON.stringify(res2.totalEarnings)}`)
        }

        console.log("   Waiting for blocks to unfreeze...")
        await sleep(2000)

        console.log("3) click 'View' button")
        const res3 = await fetch(`http://localhost:${WEBSERVER_PORT}/api/members/${from}`).then(resp => resp.json())
        console.log(res3)

        const balanceBefore = await token.balanceOf(from)
        console.log(`   Token balance before: ${balanceBefore}`)

        console.log("4) click 'Withdraw' button")
        await contract.withdrawAll(res3.withdrawableBlockNumber, res3.withdrawableEarnings, res3.proof)

        // check that we got the tokens
        const balanceAfter = await token.balanceOf(from)
        console.log(`   Token balance after: ${balanceAfter}`)

        const difference = balanceAfter.sub(balanceBefore)
        console.log(`   Withdraw effect: ${difference}`)

        assert(difference.eq(ethers.utils.parseEther("5")))
    })

    after(() => {
        operatorProcess.kill()
        spawn("rm", ["-rf", STORE_DIR])
    })
})
