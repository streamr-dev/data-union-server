const fs = require("mz/fs")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const onProcessExit = require("exit-hook")

const Sentry = require("@sentry/node")
Sentry.init({
    dsn: "https://cbb1e7aab0d541d3bf2f311a10adccee@sentry.io/1482184",
    debug: true,
})

const { getDefaultProvider, Wallet, providers: { JsonRpcProvider } } = require("ethers")

const Channel = require("./src/streamrChannel")
const { throwIfNotContract } = require("./src/utils/checkArguments")
const deployTestToken = require("./test/utils/deployTestToken")
const deployContract = require("./test/utils/deployCommunity")
const sleep = require("./src/utils/sleep-promise")

const CommunityProductServer = require("./src/server")
const getCommunitiesRouter = require("./src/routers/communities")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    STREAMR_API_KEY,
    TOKEN_ADDRESS,

    BLOCK_FREEZE_SECONDS,
    FINALITY_WAIT_SECONDS,
    GAS_PRICE_GWEI,
    //RESET,

    STORE_DIR,
    QUIET,

    // these will be used  1) for demo token  2) if TOKEN_ADDRESS doesn't support name() and symbol()
    TOKEN_SYMBOL,
    TOKEN_NAME,

    // if ETHEREUM_SERVER isn't specified, start a local Ethereum simulator (Ganache) in given port
    GANACHE_PORT,

    // web UI for revenue sharing demo
    WEBSERVER_PORT,
    // don't launch web server in start_operator script
    //   by default start serving static files under demo/public. This is for dev where UI is launched with `npm start` under demo directory.
    //EXTERNAL_WEBSERVER,
} = process.env

// TODO: log Sentry Context/scope:
//   Sentry.configureScope(scope => scope.setUser({id: community.address}))
const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
    Sentry.addBreadcrumb({
        category: "log",
        message: args.join("; "),
        level: Sentry.Severity.Log
    })
}
const error = (e, ...args) => {
    console.error(e.stack, args)
    Sentry.captureException(e)
    process.exit(1)   // TODO test: will Sentry have time to send the exception out?
}

const storeDir = fs.existsSync(STORE_DIR) ? STORE_DIR : __dirname + "/data"
const apiKey = STREAMR_API_KEY || "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"

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
        await throwIfNotContract(wallet, TOKEN_ADDRESS, "Environment variable TOKEN_ADDRESS")
        tokenAddress = TOKEN_ADDRESS
    } else {
        log("Starting Ethereum simulator...")
        const ganachePort = GANACHE_PORT || 8545
        const ganacheLog = msg => { log(" <Ganache> " + msg) }
        ganache = await require("monoplasma/src/utils/startGanache")(ganachePort, ganacheLog, error)
        const ganacheProvider = new JsonRpcProvider(ganache.url)
        wallet = new Wallet(ganache.privateKeys[0], ganacheProvider)   // use account 0: 0xa3d1f77acff0060f7213d7bf3c7fec78df847de1
        tokenAddress = await deployTestToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, {}, log)
    }

    log(`Starting community products server with operator address ${wallet.address}...`)
    const config = {
        tokenAddress,
        defaultReceiverAddress: wallet.address,
        blockFreezeSeconds: BLOCK_FREEZE_SECONDS || 1000,
        gasPrice: GAS_PRICE_GWEI || 4,
        finalityWaitSeconds: FINALITY_WAIT_SECONDS || 1000,
        lastBlockNumber: 666, // skip playback for now, TODO: fix it
    }
    const server = new CommunityProductServer(wallet, apiKey, storeDir, config, log, error)
    await server.start()

    log("Starting web server...")
    const port = WEBSERVER_PORT || 8080
    const serverURL = `http://localhost:${port}`
    const app = express()
    app.use(cors())
    app.use(bodyParser.json({limit: "50mb"}))
    app.use("/communities", getCommunitiesRouter(server))
    app.listen(port, () => log(`Web server started at ${serverURL}`))

    await sleep(200)

    // TODO: remove this, now it's there just so there's something to observe
    app.use("/admin/deploy", (req, res) => createCommunity(wallet, tokenAddress, apiKey).then(communityAddress => res.send({ communityAddress })))
    const communityAddress = await createCommunity(wallet, tokenAddress, apiKey)
    await sleep(10000)
    server.communities[communityAddress].operator.watcher.plasma.addMember(wallet.address, "Peekaboo")

    log("[DONE]")
}

async function createCommunity(wallet, tokenAddress, apiKey) {
    log("Creating a community")
    const channel = new Channel(apiKey)
    await channel.startServer()
    const communityAddress = await deployContract(wallet, wallet.address, channel.joinPartStreamName, tokenAddress, 1000)
    await sleep(100)
    // TODO: for some reason, the join doesn't go through
    await channel.publish("join", [wallet.address])
    return communityAddress
}

start().catch(error)
