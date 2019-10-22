#!/usr/bin/env node

const fs = require("mz/fs")
const path = require("path")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const onProcessExit = require("exit-hook")

const { Wallet, Contract, providers: { JsonRpcProvider } } = require("ethers")

const CommunityProductJson = require("../build/CommunityProduct.json")

const FileStore = require("monoplasma/src/fileStore")
const Operator = require("../src/operator")
const { throwIfSetButNotContract /*, throwIfNotSet */ } = require("../src/utils/checkArguments")
const deployCommunity = require("../src/utils/deployCommunity")

const deployTestToken = require("../test/utils/deployTestToken")

const operatorRouter = require("monoplasma/src/routers/member")
const adminRouter = require("monoplasma/src/routers/admin")
const Channel = require("../src/streamrChannel")

const {
    ETHEREUM_SERVER,
    ETHEREUM_NETWORK_ID,
    ETHEREUM_PRIVATE_KEY,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
    STREAMR_NODE_ADDRESS,

    TOKEN_ADDRESS,
    CONTRACT_ADDRESS,
    BLOCK_FREEZE_SECONDS,
    ADMIN_FEE,
    //GAS_PRICE_GWEI,
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
const fileStore = new FileStore(storeDir)

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
    let ethereumServer = ETHEREUM_SERVER
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
        ethereumServer = ganache.httpUrl
    }

    log(`Connecting to ${ethereumServer}`)
    const provider = new JsonRpcProvider(ethereumServer)
    // TODO: add or ignore? { gasPrice: utils.parseUnits(GAS_PRICE_GWEI || "4", "gwei") }
    const wallet = new Wallet(privateKey, provider)

    await throwIfSetButNotContract(wallet, TOKEN_ADDRESS, "Environment variable TOKEN_ADDRESS")
    await throwIfSetButNotContract(wallet, CONTRACT_ADDRESS, "Environment variable CONTRACT_ADDRESS")

    // ignore the saved config / saved state if not using a fresh ganache instance
    const config = RESET || ganache ? {} : await fileStore.loadState()
    config.tokenAddress = TOKEN_ADDRESS || config.tokenAddress || await deployTestToken(wallet, TOKEN_NAME, TOKEN_SYMBOL, log)
    config.operatorAddress = wallet.address
    config.blockFreezeSeconds = +BLOCK_FREEZE_SECONDS || config.blockFreezeSeconds || 20
    config.streamrWsUrl = STREAMR_WS_URL || config.streamrWsUrl
    config.streamrHttpUrl = STREAMR_HTTP_URL || config.streamrHttpUrl
    config.streamrNodeAddress = STREAMR_NODE_ADDRESS || config.streamrNodeAddress
    config.adminFee = ADMIN_FEE || config.adminFee || 0
    config.contractAddress = CONTRACT_ADDRESS || config.contractAddress || (await deployCommunity(wallet, config.operatorAddress, config.tokenAddress, config.streamrNodeAddress, config.blockFreezeSeconds, config.adminFee, log, config.streamrWsUrl, config.streamrHttpUrl)).address

    // augment the config / saved state with variables that may be useful for the validators
    // TODO: find another way to communicate config to demo than state.json
    config.ethereumServer = ethereumServer
    config.ethereumNetworkId = ETHEREUM_NETWORK_ID

    log("Starting the joinPartChannel and Operator")

    const contract = new Contract(config.contractAddress, CommunityProductJson.abi, this.eth)
    const joinPartStreamId = await contract.joinPartStream()
    const adminChannel = new Channel(privateKey, joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)
    await adminChannel.startServer()
    const operatorChannel = new Channel(privateKey, config.joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)
    const operator = new Operator(wallet, operatorChannel, fileStore, log, error)
    await operator.start(config)

    log("Starting web server...")
    const port = WEBSERVER_PORT || 8080
    const serverURL = `http://localhost:${port}`
    const app = express()
    app.use(cors())
    app.use(bodyParser.json({limit: "50mb"}))
    app.use("/api", operatorRouter(operator.watcher.plasma.getMemberApi()))
    app.use("/admin", adminRouter(adminChannel))
    app.use(express.static(path.join(__dirname, "demo/public")))
    app.listen(port, () => log(`Web server started at ${serverURL}`))

    log("[DONE]")
}

start().catch(error)
