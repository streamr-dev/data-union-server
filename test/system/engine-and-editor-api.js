const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")
const log = require("debug")("Streamr::dataunion::test::system::http-api")

const StreamrClient = require("streamr-client") // just for getting session tokens (ethereum-sign-in)...

const {
    Contract,
    utils: { parseEther, formatEther, getAddress, computeAddress },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains } = require("../utils/await-process-stream")
const deployContract = require("../../src/utils/deployContract")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const DataUnion = require("../../build/DataunionVault")

const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const BLOCK_FREEZE_SECONDS = 1
const ADMIN_FEE = 0.2

const {
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
    STREAMR_NODE_ADDRESS,
    ETHEREUM_SERVER,
    OPERATOR_PRIVATE_KEY,
    TOKEN_ADDRESS,
    WEBSERVER_PORT,
} = require("../CONFIG")

/**
 * Same as data-union-demo.js except only through E&E APIs,
 *   "more end-to-end" because it won't poke the stream and server directly, only talks to E&E
 * Only needs to run against streamr-ganache docker, so uses ETHEREUM_SERVER from CONFIG
 *
 * Point of view is of Streamr frontend developer, working on e.g. Marketplace
 */
describe("Data Union demo but through a running E&E instance", () => {
    let operatorProcess

    before(() => {
        log(`Creating store directory ${STORE_DIR}`)
        spawn("mkdir", ["-p", STORE_DIR])
    })

    after(() => {
        log(`Cleaning up store directory ${STORE_DIR}`)
        spawn("rm", ["-rf", STORE_DIR])
    })

    function onClose(code, signal) {
        throw new Error(`start_server.js exited with code ${code}, signal ${signal}`)
    }

    function onError(err) {
        log(`start_server.js ERROR: ${err}`)
        process.exitCode = 1
    }

    async function startServer() {
        log("--- Running start_server.js ---")
        operatorProcess = spawn(process.execPath, ["scripts/start_server.js"], {
            env: {
                STREAMR_WS_URL,
                STREAMR_HTTP_URL,
                ETHEREUM_SERVER,
                OPERATOR_PRIVATE_KEY,
                TOKEN_ADDRESS,
                STORE_DIR,
                WEBSERVER_PORT,
                BLOCK_FREEZE_SECONDS,
                RESET: "yesplease",
                DEBUG: process.env.DEBUG,
                DEBUG_COLORS: "true"
            }
        })
        operatorProcess.stdout.on("data", data => { log(`<server stdio> ${String(data).trim()}`) })
        operatorProcess.stderr.on("data", data => { log(`<server stderr> ${String(data).trim()}`) })
        operatorProcess.on("close", onClose)
        operatorProcess.on("error", onError)

        await untilStreamContains(operatorProcess.stdout, "[DONE]")

        return {
            ganacheProvider: new JsonRpcProvider(ETHEREUM_SERVER),
            adminPrivateKey: OPERATOR_PRIVATE_KEY,
            privateKey: "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // ganache 1
            address: "0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0",
        }
    }

    // for pre-started start_server.js, so to be able to debug also the server in IDE while running tests
    function connectToLocalServer() {    //eslint-disable-line no-unused-vars
        return {
            ganacheProvider: new JsonRpcProvider(ETHEREUM_SERVER),
            adminPrivateKey: OPERATOR_PRIVATE_KEY,  // ganache 0
            privateKey: "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // ganache 1
            address: "0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0",
        }
    }

    it("should get through the happy path", async function () {
        this.timeout(10 * 60 * 1000)

        const {
            ganacheProvider,
            adminPrivateKey,
            privateKey,
            address,
        } = await startServer()
        // } = connectToLocalGanache()

        log("--- Server started, getting the operator config ---")
        // TODO: eliminate direct server communication (use /stats? Change EE?)
        // TODO: maybe get configs from CONFIG.js
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        log(config)

        log(`Moving 50 tokens to ${address} for testing...`)
        const adminWallet = new Wallet(adminPrivateKey, ganacheProvider)
        const adminToken = new Contract(config.tokenAddress, ERC20Mintable.abi, adminWallet)
        //log(await adminToken.isMinter(adminWallet.address))
        const adminTransferTx = await adminToken.mint(address, parseEther("50"))
        await adminTransferTx.wait(1)

        log("1) Create a new Data Union")

        log("1.1) Get Streamr session token")
        const client = new StreamrClient({
            auth: { privateKey },
            url: STREAMR_WS_URL,
            restUrl: STREAMR_HTTP_URL,
        })
        const sessionToken = await client.session.sessionTokenPromise
        await client.ensureDisconnected()
        log("Session token: " + sessionToken)
        assert(sessionToken)

        // wrap fetch; with the Authorization header the noise is just too much...
        async function GET(url) {
            return fetch(STREAMR_HTTP_URL + url, {
                headers: {
                    "Authorization": `Bearer ${sessionToken}`
                }
            }).then(resp => resp.json())
        }
        async function POST(url, bodyObject, sessionTokenOverride, methodOverride) {
            return fetch(STREAMR_HTTP_URL + url, {
                method: methodOverride || "POST",
                body: JSON.stringify(bodyObject),
                headers: {
                    "Authorization": `Bearer ${sessionTokenOverride || sessionToken}`,
                    "Content-Type": "application/json",
                }
            }).then(resp => resp.json())
        }
        async function PUT(url, bodyObject) {
            return POST(url, bodyObject, null, "PUT")
        }

        log("1.2) create a stream that's going to go into the product")
        const stream = {
            "name": "Data Union HTTP API end-to-end test stream " + Date.now(),
            "description": "PLEASE DELETE ME, I'm a Data Union HTTP API end-to-end test stream",
            "config": {
                "fields": [{
                    "name": "string",
                    "type": "number",
                }]
            }
        }
        const streamCreateResponse = await POST("/streams", stream)
        log(`     Response: ${JSON.stringify(streamCreateResponse)}`)
        const streamId = streamCreateResponse.id
        assert(streamId)

        log("1.3) Create product in the database")
        const product = {
            "name": "Data Union HTTP API end-to-end test product " + Date.now(),
            "description": "PLEASE DELETE ME, I'm a Data Union HTTP API end-to-end test product",
            "imageUrl": "https://www.streamr.com/uploads/to-the-moon.png",
            "category": "other",        // TODO: curiously, test-category-id doesn't exist in docker mysql
            "streams": [ streamId ],
            "previewStream": streamId,
            "previewConfigJson": "string",
            "ownerAddress": address,
            "beneficiaryAddress": address,
            "pricePerSecond": 5,
            "priceCurrency": "DATA",
            "minimumSubscriptionInSeconds": 0,
            "type": "DATAUNION",
        }
        const productCreateResponse = await POST("/products", product)
        log(`     Response: ${JSON.stringify(productCreateResponse)}`)
        const productId = productCreateResponse.id
        assert(productId)

        log("1.4) Create joinPartStream")   // done inside deployContract below
        log("1.5) Deploy data union contract")
        const wallet = new Wallet(privateKey, ganacheProvider)
        const nodeAddress = getAddress(STREAMR_NODE_ADDRESS)
        const dataUnionContract = await deployContract(wallet, config.operatorAddress, config.tokenAddress, nodeAddress, BLOCK_FREEZE_SECONDS, ADMIN_FEE, config.streamrWsUrl, config.streamrHttpUrl)
        const dataUnionAddress = dataUnionContract.address

        log(`1.6) Wait until Operator starts t=${Date.now()}`)
        let stats = { error: true }
        const statsTimeout = setTimeout(() => { throw new Error("Response from E&E: " + JSON.stringify(stats)) }, 100000)
        let sleepTime = 100
        while (stats.error) {
            await sleep(sleepTime *= 2)
            stats = await GET(`/dataunions/${dataUnionAddress}/stats`).catch(() => ({error: true}))
            log(`     Response t=${Date.now()}: ${JSON.stringify(stats)}`)
        }
        clearTimeout(statsTimeout)

        log("1.7) Set beneficiary in Product DB entry")
        product.beneficiaryAddress = dataUnionAddress
        const putResponse = await PUT(`/products/${productId}`, product)
        log(`     Response: ${JSON.stringify(putResponse)}`)

        log("2) Add members")
        const memberKeys = [privateKey,
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000000000000000000000000000002",
            "0x0000000000000000000000000000000000000000000000000000000000000003",
            "0x0000000000000000000000000000000000000000000000000000000000000004",
            "0x0000000000000000000000000000000000000000000000000000000000000005",
            "0x0000000000000000000000000000000000000000000000000000000000000006",
            "0x0000000000000000000000000000000000000000000000000000000000000007",
            "0x0000000000000000000000000000000000000000000000000000000000000008",
            "0x0000000000000000000000000000000000000000000000000000000000000009",
        ]

        log("2.1) Add data union secret")
        const secretCreateResponse = await POST(`/dataunions/${dataUnionAddress}/secrets`, {
            name: "PLEASE DELETE ME, I'm a data union Product server test secret",
        })
        log(`     Response: ${JSON.stringify(secretCreateResponse)}`)
        const { secret } = secretCreateResponse

        log("2.2) Send JoinRequests")
        for (const privateKey of memberKeys) {
            const memberAddress = computeAddress(privateKey)
            const tempClient = new StreamrClient({
                auth: { privateKey },
                url: STREAMR_WS_URL,
                restUrl: STREAMR_HTTP_URL,
            })
            const joinResponse = await POST(`/dataunions/${dataUnionAddress}/joinRequests`, {
                memberAddress,
                secret,
                metadata: { test: "PLEASE DELETE ME, I'm a data union Product server test joinRequest" },
            }, await tempClient.session.sessionTokenPromise)
            await tempClient.ensureDisconnected()
            log(`     Response: ${JSON.stringify(joinResponse)}`)
        }

        log("2.3) Wait until members have been added")
        let members = []
        sleepTime = 1000
        while (!(members.length >= 10)) {
            await sleep(sleepTime)
            members = await GET(`/dataunions/${dataUnionAddress}/members`)
            log("members: ", members)
        }

        // TODO: send revenue by purchasing the product on Marketplace
        log("3) Send revenue in and check tokens were distributed")
        const memberBeforeRevenues = await GET(`/dataunions/${dataUnionAddress}/members/${address}`)
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            const balance = await token.balanceOf(address)
            log(`   Sending 10 tokens (out of remaining ${formatEther(balance)}) to DataUnion contract...`)

            const transferTx = await token.transfer(dataUnionAddress, parseEther("10"))
            await transferTx.wait(2)

            // check total revenue
            const res3 = await GET(`/dataunions/${dataUnionAddress}/stats`)
            log(`   Total revenue: ${formatEther(res3.totalEarnings || "0")}`)
        }

        log("3.1) Wait for blocks to unfreeze...") //... and also that state updates.

        const expectedAdminEarnings = parseEther("14").toString()
        let member = memberBeforeRevenues
        // wait until member.withdrawableEarnings is at least expected earnings
        while ((member.withdrawableEarnings - memberBeforeRevenues.withdrawableEarnings) < expectedAdminEarnings) {
            await sleep(1000)
            member = await GET(`/dataunions/${dataUnionAddress}/members/${address}`)
        }

        // add so CI more reliable until error_frozen issue has a workaround+test
        await sleep(3000)

        log(`    Member before: ${JSON.stringify(member)}`)

        log("4) Withdraw tokens")

        const balanceBefore = await token.balanceOf(address)
        log(`   Token balance before: ${formatEther(balanceBefore)}`)

        const contract = new Contract(dataUnionAddress, DataUnion.abi, wallet)
        const withdrawTx = await contract.withdrawAll(member.withdrawableBlockNumber, member.withdrawableEarnings, member.proof)
        log("    withdrawAll done")
        await withdrawTx.wait(2)
        log("    withdrawAll confirmed")

        const res4b = await GET(`/dataunions/${dataUnionAddress}/members/${address}`)
        log("    member stats after", res4b)

        const balanceAfter = await token.balanceOf(address)
        log(`   Token balance after: ${formatEther(balanceAfter)}`)

        const difference = balanceAfter.sub(balanceBefore)
        log(`   Withdraw effect: ${formatEther(difference)}`)

        log("4.1) Withdraw tokens for another account")
        const address2 = members[1].address // 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
        const member2 = await GET(`/dataunions/${dataUnionAddress}/members/${address2}`)
        log("    Member2 stats before", res4b)
        Object.keys(member2).forEach(k => log(`    ${k} ${JSON.stringify(member2[k])}`))

        const balanceBefore2 = await token.balanceOf(address2)
        log(`   Token balance before: ${formatEther(balanceBefore2)}`)

        const withdrawTx2 = await contract.withdrawAllFor(address2, member2.withdrawableBlockNumber, member2.withdrawableEarnings, member2.proof)
        log("    withdrawAll done")
        await withdrawTx2.wait(2)
        log("    withdrawAll confirmed")

        const res4c = await GET(`/dataunions/${dataUnionAddress}/members/${address2}`)
        log("    Member2 stats after", res4c)

        const balanceAfter2 = await token.balanceOf(address2)
        log(`   Token balance after: ${formatEther(balanceAfter2)}`)

        const difference2 = balanceAfter2.sub(balanceBefore2)
        log(`   Withdraw effect: ${formatEther(difference2)}`)

        const expectedMember2Earnings = parseEther("4").toString()
        assert.strictEqual(member.withdrawableEarnings, expectedAdminEarnings)
        assert.strictEqual(member2.withdrawableEarnings, expectedMember2Earnings)
        assert.strictEqual(difference.toString(), expectedAdminEarnings)
        assert.strictEqual(difference2.toString(), expectedMember2Earnings)
    })

    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.removeListener("close", onClose)
            operatorProcess.removeListener("error", onError)
            operatorProcess.kill()
            operatorProcess = null
        }
    })
})
