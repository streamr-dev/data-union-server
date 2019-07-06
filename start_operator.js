#!/usr/bin/env node

const fs = require("mz/fs")
const path = require("path")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const onProcessExit = require("exit-hook")

const { utils, Wallet, providers: { JsonRpcProvider } } = require("ethers")

const getFileStore = require("monoplasma/src/fileStore")
const Operator = require("./src/operator")
const { throwIfSetButNotContract /*, throwIfNotSet */ } = require("./src/utils/checkArguments")
const defaultServers = require("./defaultServers.json")
const deployTestToken = require("./test/utils/deployTestToken")
const deployContract = require("./test/utils/deployCommunity")

const operatorRouter = require("monoplasma/src/routers/member")
const adminRouter = require("monoplasma/src/routers/admin")
const Channel = require("./src/streamrChannel")

const {
    ETHEREUM_SERVER,
    ETHEREUM_NETWORK_ID,
    ETHEREUM_PRIVATE_KEY,
    JOIN_PART_STREAM_NAME,
    STREAMR_API_KEY,
    TOKEN_ADDRESS,
    CONTRACT_ADDRESS,
    BLOCK_FREEZE_SECONDS,
    GAS_PRICE_GWEI,
    RESET,
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

const log = QUIET ? () => {} : console.log
const error = (e, ...args) => {
    console.error(e.stack, args)
    process.exit(1)
}

const storeDir = fs.existsSync(STORE_DIR) ? STORE_DIR : __dirname + "/demo/public/data"
const fileStore = getFileStore(storeDir)

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
    let privateKey
    let ethereumServer = ETHEREUM_SERVER || defaultServers[ETHEREUM_NETWORK_ID]
    if (ethereumServer) {
        if (!ETHEREUM_PRIVATE_KEY) { throw new Error("Private key required to deploy the airdrop contract. Deploy transaction must be signed.") }
        privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
        if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    } else {
        // use account 0: 0xa3d1f77acff0060f7213d7bf3c7fec78df847de1
        privateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
        log("Starting Ethereum simulator...")
        const ganachePort = GANACHE_PORT || 8545
        const ganacheLog = msg => { log(" <Ganache> " + msg) }
        ganache = await require("monoplasma/src/utils/startGanache")(ganachePort, ganacheLog, error)
        ethereumServer = ganache.url
    }

    log(`Connecting to ${ethereumServer}`)
    const provider = new JsonRpcProvider(ethereumServer)
    const wallet = new Wallet(privateKey, provider)

    await throwIfSetButNotContract(wallet, TOKEN_ADDRESS, "Environment variable TOKEN_ADDRESS")
    await throwIfSetButNotContract(wallet, CONTRACT_ADDRESS, "Environment variable CONTRACT_ADDRESS")
    //throwIfNotSet(STREAMR_API_KEY, "Environment variable STREAMR_API_KEY")

    const opts = {
        from: wallet.address,
        gas: 4000000,
        gasPrice: utils.parseUnits(GAS_PRICE_GWEI || "4", "gwei"),
    }

    // ignore the saved config / saved state if not using a fresh ganache instance
    const config = RESET || ganache ? {} : await fileStore.loadState()
    config.tokenAddress = TOKEN_ADDRESS || config.tokenAddress || await deployTestToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, opts, log)
    config.operatorAddress = wallet.address
    config.blockFreezeSeconds = +BLOCK_FREEZE_SECONDS || config.blockFreezeSeconds || 20
    config.streamrApiKey = STREAMR_API_KEY || "NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg"
    config.joinPartStreamName = JOIN_PART_STREAM_NAME || `test-joinPartStream-${+new Date()}`
    config.contractAddress = CONTRACT_ADDRESS || config.contractAddress || await deployContract(wallet, config.operatorAddress, config.joinPartStreamName, config.tokenAddress, config.blockFreezeSeconds, log)
    config.defaultReceiverAddress = wallet.address

    // augment the config / saved state with variables that may be useful for the validators
    // TODO: find another way to communicate config to demo than state.json
    config.ethereumServer = ethereumServer
    config.ethereumNetworkId = ETHEREUM_NETWORK_ID

    log("Starting the joinPartChannel and Operator")
    const adminChannel = new Channel(config.streamrApiKey, config.joinPartStreamName)
    await adminChannel.startServer()
    const operatorChannel = new Channel(config.streamrApiKey, config.joinPartStreamName)
    const operator = new Operator(wallet, operatorChannel, fileStore, log, error)
    await operator.start(config)

    log("Starting web server...")
    const port = WEBSERVER_PORT || 8080
    const serverURL = `http://localhost:${port}`
    const app = express()
    app.use(cors())
    app.use(bodyParser.json({limit: "50mb"}))
    app.use("/api", operatorRouter(operator.plasma.getMemberApi()))
    app.use("/admin", adminRouter(adminChannel))
    app.use(express.static(path.join(__dirname, "demo/public")))
    app.listen(port, () => log(`Web server started at ${serverURL}`))

    log("[DONE]")
}

start().catch(error)
