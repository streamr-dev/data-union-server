const { spawn } = require("child_process")
const fetch = require("node-fetch")
const assert = require("assert")

const StreamrClient = require("streamr-client")

const {
    Contract,
    utils: { parseEther, formatEther, getAddress, computeAddress },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const sleep = require("../../src/utils/sleep-promise")
const { untilStreamContains } = require("../utils/await-until")
const deployCommunity = require("../../src/utils/deployCommunity")

const ERC20Mintable = require("../../build/ERC20Mintable.json")
const CommunityProduct = require("../../build/CommunityProduct.json")

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
} = require("./CONFIG")

/**
 * Same as community-product-demo.js except only through E&E APIs,
 *   "more end-to-end" because it won't poke the stream and server directly, only talks to E&E
 * Only needs to run against dev docker, hence run againt streamr-ganache docker,
 *   notice the hard-coded ETHEREUM_SERVER (TODO: why not support stand-alone too though)
 */
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

    async function startServer() {
        console.log("--- Running start_server.js ---")
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
            }
        })
        operatorProcess.stdout.on("data", data => { console.log(`<server> ${data.toString().trim()}`) })
        operatorProcess.stderr.on("data", data => { console.log(`server *** ERROR: ${data}`) })
        operatorProcess.on("close", code => { console.log(`start_server.js exited with code ${code}`) })
        operatorProcess.on("error", err => { console.log(`start_server.js ERROR: ${err}`) })

        await untilStreamContains(operatorProcess.stdout, "[DONE]")

        return {
            ganacheProvider: new JsonRpcProvider(ETHEREUM_SERVER),
            adminPrivateKey: OPERATOR_PRIVATE_KEY,
            privateKey: "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // ganache 1
            address: "0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0",
        }
    }

    // for pre-started start_server.js, so to be able to debug also the server in IDE while running tests
    function connectToLocalGanache() {    //eslint-disable-line no-unused-vars
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
        // } = connectToLocalGanache()

        console.log("--- Server started, getting the operator config ---")
        // TODO: eliminate direct server communication (use /stats? Change EE?)
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        console.log(config)

        console.log(`Moving 50 tokens to ${address} for testing...`)
        const adminWallet = new Wallet(adminPrivateKey, ganacheProvider)
        const adminToken = new Contract(config.tokenAddress, ERC20Mintable.abi, adminWallet)
        //console.log(await adminToken.isMinter(adminWallet.address))
        const adminTransferTx = await adminToken.mint(address, parseEther("50"))
        await adminTransferTx.wait(1)

        console.log("1) Create a new Community product")

        console.log("1.1) Get Streamr session token")
        /*
        const apiKey = "tester1-api-key"
        const loginResponse = await fetch(`${STREAMR_HTTP_URL}/login/apikey`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey }),
        }).then(resp => resp.json())
        console.log(`     Response: ${JSON.stringify(loginResponse)}`)
        const sessionToken = loginResponse.token
        */
        const client = new StreamrClient({
            auth: { privateKey },
            url: STREAMR_WS_URL,
            restUrl: STREAMR_HTTP_URL,
        })
        const sessionToken = await client.session.sessionTokenPromise
        console.log("Session token: " + sessionToken)
        assert(sessionToken)

        // wrap fetch; with the Authorization header the noise is just too much...
        async function GET(url) {
            return fetch(STREAMR_HTTP_URL + url, {
                headers: {
                    "Authorization": `Bearer ${sessionToken}`
                }
            }).then(resp => resp.json())
        }
        async function POST(url, bodyObject) {
            return fetch(STREAMR_HTTP_URL + url, {
                method: "POST",
                body: JSON.stringify(bodyObject),
                headers: {
                    "Authorization": `Bearer ${sessionToken}`,
                    "Content-Type": "application/json",
                }
            }).then(resp => resp.json())
        }

        console.log("1.2) create a stream that's going to go into the product")
        const stream = {
            "name": "Community Product server test stream " + Date.now(),
            "description": "PLEASE DELETE ME, I'm a Community Product server test stream",
            "config": {
                "fields": [{
                    "name": "string",
                    "type": "number",
                }]
            }
        }
        const streamCreateResponse = await POST("/streams", stream)
        console.log(`     Response: ${JSON.stringify(streamCreateResponse)}`)
        const streamId = streamCreateResponse.id
        assert(streamId)

        console.log("1.3) Create product in the database")
        const product = {
            "name": "Community Product server test product " + Date.now(),
            "description": "PLEASE DELETE ME, I'm a Community Product server test product",
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
            "type": "COMMUNITY",
        }
        const productCreateResponse = await POST("/products", product)
        console.log(`     Response: ${JSON.stringify(productCreateResponse)}`)
        const productId = productCreateResponse.id
        assert(productId)

        console.log("1.4) Create joinPartStream")   // done inside deployCommunity below
        console.log("1.5) Deploy CommunityProduct contract")
        const wallet = new Wallet(privateKey, ganacheProvider)
        const nodeAddress = getAddress(STREAMR_NODE_ADDRESS)
        const communityContract = await deployCommunity(wallet, config.operatorAddress, config.tokenAddress, nodeAddress, BLOCK_FREEZE_SECONDS, ADMIN_FEE, console.log, config.streamrWsUrl, config.streamrHttpUrl)
        const communityAddress = communityContract.address

        console.log("1.6) Wait until Operator starts")
        let stats = { error: true }
        const statsTimeout = setTimeout(() => { throw new Error("Response from E&E: " + JSON.stringify(stats)) }, 100000)
        let sleepTime = 100
        while (stats.error) {
            await sleep(sleepTime *= 2)
            stats = await GET(`/communities/${communityAddress}/stats`).catch(() => ({error: true}))
        }
        clearTimeout(statsTimeout)
        console.log(`     Stats before adding: ${JSON.stringify(stats)}`)

        console.log("1.7) Set beneficiary in Product DB entry")
        product.beneficiaryAddress = communityAddress
        const putResponse = await fetch(`${STREAMR_HTTP_URL}/products/${productId}`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${sessionToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(product),
        }).then(resp => resp.json())
        console.log(`     Response: ${JSON.stringify(putResponse)}`)

        console.log("2) Add members")
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

        console.log("2.1) Add community secret")
        const secretCreateResponse = await POST(`/communities/${communityAddress}/secrets`, {
            name: "PLEASE DELETE ME, I'm a Community Product server test secret",
            secret: "test",
        })
        console.log(`     Response: ${JSON.stringify(secretCreateResponse)}`)

        console.log("2.2) Send JoinRequests")
        for (const privateKey of memberKeys) {
            const memberAddress = computeAddress(privateKey)
            const tempClient = new StreamrClient({
                auth: { privateKey },
                url: STREAMR_WS_URL,
                restUrl: STREAMR_HTTP_URL,
            })
            const memberSessionToken = await tempClient.session.sessionTokenPromise
            const joinResponse = await fetch(`${STREAMR_HTTP_URL}/communities/${communityAddress}/joinRequests`, {
                method: "POST",
                body: JSON.stringify({
                    memberAddress,
                    secret: "test",
                    metadata: { test: "PLEASE DELETE ME, I'm a Community Product server test joinRequest" },
                }),
                headers: {
                    "Authorization": `Bearer ${memberSessionToken}`,
                    "Content-Type": "application/json",
                }
            }).then(resp => resp.json())
            console.log(`     Response: ${JSON.stringify(joinResponse)}`)
        }

        console.log("2.3) Wait until members have been added")
        let members = []
        sleepTime = 100
        while (members.length < 1) {
            await sleep(sleepTime *= 2)
            members = await GET(`/communities/${communityAddress}/members`)
        }

        console.log("3) Send revenue in and check tokens were distributed")
        const memberBeforeRevenues = await GET(`/communities/${communityAddress}/members/${address}`)
        const token = new Contract(config.tokenAddress, ERC20Mintable.abi, wallet)
        for (let i = 0; i < 5; i++) {
            const balance = await token.balanceOf(address)
            console.log(`   Sending 10 tokens (out of remaining ${formatEther(balance)}) to CommunityProduct contract...`)

            const transferTx = await token.transfer(communityAddress, parseEther("10"))
            await transferTx.wait(2)

            // check total revenue
            const res3 = await GET(`/communities/${communityAddress}/stats`)
            console.log(`   Total revenue: ${formatEther(res3.totalEarnings)}`)
        }

        console.log("3.1) Wait for blocks to unfreeze...") //... and also that state updates.
        let member = memberBeforeRevenues
        // TODO: what's the expected final withdrawableEarnings?
        while (member.withdrawableEarnings < 1 + memberBeforeRevenues.withdrawableEarnings) {
            await sleep(1000)
            member = await GET(`/communities/${communityAddress}/members/${address}`)
        }
        Object.keys(member).forEach(k => console.log(`    ${k} ${JSON.stringify(member[k])}`))

        console.log("4) Withdraw tokens")

        const balanceBefore = await token.balanceOf(address)
        console.log(`   Token balance before: ${formatEther(balanceBefore)}`)

        const contract = new Contract(communityAddress, CommunityProduct.abi, wallet)
        const withdrawTx = await contract.withdrawAll(member.withdrawableBlockNumber, member.withdrawableEarnings, member.proof)
        await withdrawTx.wait(2)

        const res4b = await GET(`/communities/${communityAddress}/members/${address}`)
        Object.keys(res4b).forEach(k => console.log(`    ${k} ${JSON.stringify(res4b[k])}`))

        const balanceAfter = await token.balanceOf(address)
        console.log(`   Token balance after: ${formatEther(balanceAfter)}`)

        const difference = balanceAfter.sub(balanceBefore)
        console.log(`   Withdraw effect: ${formatEther(difference)}`)

        console.log("4.1) Withdraw tokens for another account")
        const address2 = members[1].address // 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
        const member2 = await GET(`/communities/${communityAddress}/members/${address2}`)
        Object.keys(member2).forEach(k => console.log(`    ${k} ${JSON.stringify(member2[k])}`))

        const balanceBefore2 = await token.balanceOf(address2)
        console.log(`   Token balance before: ${formatEther(balanceBefore2)}`)

        const withdrawTx2 = await contract.withdrawAllFor(address2, member2.withdrawableBlockNumber, member2.withdrawableEarnings, member2.proof)
        await withdrawTx2.wait(2)

        const res4c = await GET(`/communities/${communityAddress}/members/${address2}`)
        Object.keys(res4c).forEach(k => console.log(`    ${k} ${JSON.stringify(res4c[k])}`))

        const balanceAfter2 = await token.balanceOf(address2)
        console.log(`   Token balance after: ${formatEther(balanceAfter2)}`)

        const difference2 = balanceAfter2.sub(balanceBefore2)
        console.log(`   Withdraw effect: ${formatEther(difference2)}`)

        const adminEarnings = parseEther("14").toString()
        const memberEarnings = parseEther("4").toString()
        assert.strictEqual(member.withdrawableEarnings, adminEarnings)
        assert.strictEqual(member2.withdrawableEarnings, memberEarnings)
        assert.strictEqual(difference.toString(), adminEarnings)
        assert.strictEqual(difference2.toString(), memberEarnings)
    })

    afterEach(() => {
        if (operatorProcess) {
            operatorProcess.kill()
            operatorProcess = null
        }
    })
})
