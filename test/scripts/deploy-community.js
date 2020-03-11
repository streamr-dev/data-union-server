const fetch = require("node-fetch")
const { spawn } = require("child_process")
const assert = require("assert")

const log = require("debug")("Streamr::CPS::test::integration::deploy-community-script")

const {
    Contract,
    utils: { getAddress },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const { untilStreamContains, untilStreamMatches, capture } = require("../utils/await-until")

const sleep = require("../../src/utils/sleep-promise")
const deployCommunity = require("../../src/utils/deployCommunity")

const CommunityJson = require("../../build/CommunityProduct")

const { streamrWs, streamrHttp, streamrNodeAddress } = require("../integration/CONFIG")

const STORE_DIR = __dirname + `/test-store-${+new Date()}`
const GANACHE_PORT = 8549
const WEBSERVER_PORT = 8881
const BLOCK_FREEZE_SECONDS = 1
const ADMIN_FEE = 0.2

async function startServer() {
    log("--- Running start_server.js ---")
    const serverProcess = spawn(process.execPath, ["scripts/start_server.js"], {
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
    serverProcess.stdout.on("data", data => { log(`<server> ${data.toString().trim()}`) })
    serverProcess.stderr.on("data", data => { log(`server *** ERROR: ${data}`) })
    serverProcess.on("close", code => { log(`start_server.js exited with code ${code}`) })
    serverProcess.on("error", err => { log(`start_server.js ERROR: ${err}`) })

    const privateKeyMatch = capture(serverProcess.stdout, /<Ganache> \(.\) (0x[a-f0-9]{64})/, 9)
    const ganacheUrlMatch = untilStreamMatches(serverProcess.stdout, /Listening on (.*)/)
    await untilStreamContains(serverProcess.stdout, "[DONE]")

    const keys = await privateKeyMatch
    const providerUrl = "http://" + (await ganacheUrlMatch)[1]

    return {
        providerUrl,
        serverProcess,
        keys,
    }
}

async function runDeployScript(ETHEREUM_SERVER, ETHEREUM_PRIVATE_KEY, OPERATOR_ADDRESS, TOKEN_ADDRESS, STREAMR_NODE_ADDRESS, STREAMR_WS_URL, STREAMR_HTTP_URL) {
    log("--- Running deploy_community.js ---")
    const deployProcess = spawn(process.execPath, ["scripts/deploy_community.js"], {
        env: {
            ETHEREUM_SERVER,            // explicitly specify server address
            ETHEREUM_PRIVATE_KEY,
            TOKEN_ADDRESS,
            BLOCK_FREEZE_SECONDS,
            STREAMR_WS_URL,
            STREAMR_HTTP_URL,
            //GAS_PRICE_GWEI,   // TODO: include?
            OPERATOR_ADDRESS,
            STREAMR_NODE_ADDRESS,
            ADMIN_FEE,
        }
    })
    deployProcess.stdout.on("data", data => { log(`<deploy> ${data.toString().trim()}`) })
    deployProcess.stderr.on("data", data => { log(`deploy *** ERROR: ${data}`) })
    deployProcess.on("close", code => { log(`deploy_community.js exited with code ${code}`) })
    deployProcess.on("error", err => { log(`deploy_community.js ERROR: ${err}`) })

    const addressMatch = untilStreamMatches(deployProcess.stdout, /Deployed community contract at (.*)/)
    const streamIdMatch = untilStreamMatches(deployProcess.stdout, /JoinPartStream ID: (.*)/)
    await untilStreamContains(deployProcess.stdout, "[DONE]")

    const contractAddress = (await addressMatch)[1]
    const joinPartStreamId = (await streamIdMatch)[1]

    return {
        contractAddress,
        joinPartStreamId,
        deployProcess,
    }
}

describe.skip("Deploy community script", () => {
    let processesToCleanUp = []
    afterEach(async () => {
        for (const p of processesToCleanUp) {
            p.kill()
            await sleep(100)
        }
    })

    it("successfully deploys a community using the script", async function() {
        this.timeout(60000)
        const {
            providerUrl,
            serverProcess,
            keys,
        } = await startServer()
        processesToCleanUp.push(serverProcess)

        log("--- Server started, getting the operator config ---")
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        log(config)

        const nodeAddress = getAddress(streamrNodeAddress)
        const {
            contractAddress,
            joinPartStreamId,
            deployProcess,
        } = await runDeployScript(
            providerUrl,
            keys[4],
            config.operatorAddress,
            config.tokenAddress,
            nodeAddress,
            config.streamrWsUrl,
            config.streamrHttpUrl
        )
        processesToCleanUp.push(deployProcess)

        const provider = new JsonRpcProvider(providerUrl)
        const communityContract = new Contract(contractAddress, CommunityJson.abi, provider)
        const freeze = await communityContract.blockFreezeSeconds()
        assert.strictEqual(freeze.toString(), BLOCK_FREEZE_SECONDS.toString())

        log("Waiting for the operator to notice...")
        let stats = { error: true }
        while (stats.error) {
            await sleep(100)
            stats = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityContract.address}/stats`).then(resp => resp.json())
        }

        assert.strictEqual(stats.totalEarnings, "0")

        assert(joinPartStreamId)    // TODO: assert it's readable to all
    })

    it("successfully deploys a community using the helper function directly", async function() {
        this.timeout(60000)
        const {
            providerUrl,
            serverProcess,
            keys,
        } = await startServer()
        processesToCleanUp.push(serverProcess)

        log("--- Server started, getting the operator config ---")
        const config = await fetch(`http://localhost:${WEBSERVER_PORT}/config`).then(resp => resp.json())
        log(config)

        const provider = new JsonRpcProvider(providerUrl)
        const wallet = new Wallet(keys[3], provider)

        const nodeAddress = getAddress(streamrNodeAddress)
        const communityContract = await deployCommunity(wallet, config.operatorAddress, config.tokenAddress, nodeAddress, BLOCK_FREEZE_SECONDS, ADMIN_FEE, config.streamrWsUrl, config.streamrHttpUrl)

        const freeze = await communityContract.blockFreezeSeconds()
        assert.strictEqual(freeze.toString(), BLOCK_FREEZE_SECONDS.toString())

        let stats = { error: true }
        while (stats.error) {
            await sleep(100)
            stats = await fetch(`http://localhost:${WEBSERVER_PORT}/communities/${communityContract.address}/stats`).then(resp => resp.json())
        }

        assert.strictEqual(stats.totalEarnings, "0")
    })
})
