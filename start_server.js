const fs = require("mz/fs")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const onProcessExit = require("exit-hook")
const { utils: { parseEther } } = require("ethers")

const {
    Contract,
    utils,
    getDefaultProvider,
    Wallet,
    utils: { getAddress },
    providers: { JsonRpcProvider }
} = require("ethers")

const Channel = require("./src/streamrChannel")
const { throwIfNotContract, throwIfBadAddress } = require("./src/utils/checkArguments")
const deployCommunity = require("./src/utils/deployCommunity")
const sleep = require("./src/utils/sleep-promise")

const deployTestToken = require("./test/utils/deployTestToken")

const CommunityProductServer = require("./src/server")
const getCommunitiesRouter = require("./src/routers/communities")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    TOKEN_ADDRESS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    BLOCK_FREEZE_SECONDS,
    FINALITY_WAIT_SECONDS,
    GAS_PRICE_GWEI,
    //RESET,

    STORE_DIR,
    QUIET,

    DEVELOPER_MODE,

    // these will be used  1) for demo token  2) if TOKEN_ADDRESS doesn't support name() and symbol()
    TOKEN_SYMBOL,
    TOKEN_NAME,

    // if ETHEREUM_SERVER isn't specified, start a local Ethereum simulator (Ganache) in given port
    GANACHE_PORT,

    // HTTP API for /config and /communities endpoints
    WEBSERVER_PORT,

    SENTRY_TOKEN,
} = process.env

let Sentry
if (SENTRY_TOKEN) {
    Sentry = require("@sentry/node")
    Sentry.init({
        dsn: `https://${SENTRY_TOKEN}@sentry.io/1482184`,
        debug: true,
    })
}

// TODO: log Sentry Context/scope:
//   Sentry.configureScope(scope => scope.setUser({id: community.address}))
const log = QUIET ? (() => {}) : (...args) => {
    console.log(...args)
    Sentry && Sentry.addBreadcrumb({
        category: "log",
        message: args.join("; "),
        level: Sentry.Severity.Log
    })
}
const error = (e, ...args) => {
    console.error(e.stack || e, ...args)
    Sentry && Sentry.captureException(e)
    // TODO: it seems Sentry won't have time to send the exception out
    //   is it better to wait? How to check if Sentry received it?
    //   program should be halted at any rate. Put reporting into separate process?
    process.exit(1)
}

const storeDir = fs.existsSync(STORE_DIR) ? STORE_DIR : __dirname + "/store"

let ganache = null
function stopGanache() {
    if (ganache) {
        log("Shutting down Ethereum simulator...")
        ganache.shutdown()
        ganache = null
    }
}
onProcessExit(stopGanache)

async function start() {

    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null

    let wallet, tokenAddress
    if (provider) {
        try {
            log(`Connecting to ${provider._network.name} network, ${provider.providers[0].connection.url}`)
        } catch (e) { /*ignore*/ }
        if (!ETHEREUM_PRIVATE_KEY) { throw new Error("Private key required to operate Monoplasma, for 'commit' transactions.") }
        const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
        if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
        wallet = new Wallet(privateKey, provider)
    } else {
        log("Starting Ethereum simulator...")
        const ganachePort = GANACHE_PORT || 8545
        const ganacheLog = msg => { log(" <Ganache> " + msg) }
        ganache = await require("monoplasma/src/utils/startGanache")(ganachePort, ganacheLog, error, 4)
        const ganacheProvider = new JsonRpcProvider(ganache.httpUrl)
        wallet = new Wallet(ganache.privateKeys[0], ganacheProvider)   // use account 0: 0xa3d1f77acff0060f7213d7bf3c7fec78df847de1
    }

    if (TOKEN_ADDRESS) {
        tokenAddress = getAddress(TOKEN_ADDRESS)
        await throwIfNotContract(wallet.provider, tokenAddress, "Environment variable TOKEN_ADDRESS")
    } else {
        tokenAddress = await deployTestToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, log)
    }

    // TODO: load server state, find communities from store
    // TODO: getLogs from blockchain to find communities?

    const operatorAddress = wallet.address
    log(`Starting community products server with operator address ${operatorAddress}...`)
    const config = {
        tokenAddress,
        operatorAddress,
        defaultReceiverAddress: wallet.address,
        blockFreezeSeconds: BLOCK_FREEZE_SECONDS || 1000,
        gasPrice: utils.parseUnits(GAS_PRICE_GWEI || "4", "gwei"),
        finalityWaitSeconds: FINALITY_WAIT_SECONDS || 1000,
        streamrWsUrl: STREAMR_WS_URL,
        streamrHttpUrl: STREAMR_HTTP_URL,
    }
    const server = new CommunityProductServer(wallet, storeDir, config, log, error)
    await server.start()

    log("Starting web server...")
    const port = WEBSERVER_PORT || 8080
    const serverURL = `http://localhost:${port}`
    const app = express()
    app.use(cors())
    app.use(bodyParser.json({limit: "50mb"}))
    app.get("/config", (req, res) => { res.send(config) })
    app.use("/communities", getCommunitiesRouter(server))
    app.listen(port, () => log(`Web server started at ${serverURL}`))

    await sleep(200)
    log("[DONE]")

    if (DEVELOPER_MODE) {
        const streamrNodeAddress = process.env.STREAMR_NODE_ADDRESS || "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c" // node address in docker dev environment
        log("DEVELOPER MODE: /admin endpoints available: addRevenue, deploy, addTo/{address}")
        const contract = await deployCommunity(wallet, wallet.address, tokenAddress, streamrNodeAddress, 1000, log, config.streamrWsUrl, config.streamrHttpUrl)
        const communityAddress = contract.address
        app.use("/admin/addRevenue", (req, res) => transfer(wallet, communityAddress, tokenAddress).then(tr => res.send(tr)).catch(error => res.status(500).send({error})))
        app.use("/admin/deploy", (req, res) => deployCommunity(wallet, wallet.address, tokenAddress, streamrNodeAddress, 1000, log, config.streamrWsUrl, config.streamrHttpUrl).then(({contract: { address }}) => res.send({ address })).catch(error => res.status(500).send({error})))
        app.use("/admin/addTo/:communityAddress", (req, res) => transfer(wallet, req.params.communityAddress, tokenAddress).then(tr => res.send(tr)).catch(error => res.status(500).send({error})))

        log(`Deployed community at ${communityAddress}, waiting for server to notice...`)
        await server.communityIsRunning(communityAddress)
        await sleep(500)

        log("Adding members...")
        const streamId = await contract.joinPartStream()
        const channel = new Channel(wallet.privateKey, streamId, config.streamrWsUrl, config.streamrHttpUrl)
        await channel.startServer()
        await channel.publish("join", [
            wallet.address,
            "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
            "0x4178babe9e5148c6d5fd431cd72884b07ad855a0",
        ])
        log("Waiting for server to notice joins...")
        while (server.communities[communityAddress].operator.watcher.messageQueue.length > 0) {
            await sleep(1000)
        }

        await transfer(wallet, communityAddress, tokenAddress)

        // this is here just so it's easy to add a breakpoint and inspect this scope
        for (;;) {
            await sleep(1000)
        }
    }
}

const ERC20Mintable = require("./build/ERC20Mintable.json")
async function transfer(wallet, targetAddress, tokenAddress, amount) {
    throwIfBadAddress(targetAddress, "token transfer target address")
    // TODO: null token address => attempt ether transfer?
    await throwIfNotContract(wallet.provider, tokenAddress, "token address")
    const token = new Contract(tokenAddress, ERC20Mintable.abi, wallet)
    const tx = await token.transfer(targetAddress, amount || parseEther("1"))
    const tr = await tx.wait(1)
    return tr
}

start().catch(error)
