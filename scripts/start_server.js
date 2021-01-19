require("dotenv/config")

const fs = require("mz/fs")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const morgan = require("morgan")

const {
    Contract,
    utils,
    getDefaultProvider,
    Wallet,
    utils: { parseEther },
    providers: { JsonRpcProvider }
} = require("ethers")

const Channel = require("../src/streamrChannel")
const { throwIfNotContract, throwIfBadAddress } = require("../src/utils/checkArguments")
const deployContract = require("../src/utils/deployContract")
const sleep = require("../src/utils/sleep-promise")

const DataUnionServer = require("../src/server")
const getServerRouter = require("../src/routers/server")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    OPERATOR_PRIVATE_KEY,
    TOKEN_ADDRESS,
    STREAMR_WS_URL,             // default: production
    STREAMR_HTTP_URL,           // default: production
    STORE_DIR,
    QUIET,
    GAS_PRICE_GWEI,
    POLLING_INTERVAL_MS,
    //RESET,

    // Safety parameter
    FINALITY_WAIT_SECONDS,

    // Optional; HTTP API for /config and /dataunions endpoints
    WEBSERVER_PORT,

    // Optional; for sending out the error reports
    SENTRY_TOKEN,

    DEVELOPER_MODE, // TODO: remove
    BLOCK_FREEZE_SECONDS, // TODO: remove
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
//   Sentry.configureScope(scope => scope.setUser({id: dataUnion.address}))
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

    // from https://docs.sentry.io/error-reporting/configuration/draining/?platform=browsernpm
    const sentryClient = Sentry && Sentry.getCurrentHub().getClient()
    if (sentryClient) {
        sentryClient.close(2000).then(() => process.exit(1))
    } else {
        process.exitCode = 1
    }
}

const storeDir = fs.existsSync(STORE_DIR) ? STORE_DIR : __dirname + "/store"

async function start() {

    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) {
        throw new Error("Please provide either ETHEREUM_SERVER or ETHEREUM_NETWORK environment variable")
    }

    if (POLLING_INTERVAL_MS > 0) {
        provider.pollingInterval = +POLLING_INTERVAL_MS
    }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    if (!OPERATOR_PRIVATE_KEY) { throw new Error("env OPERATOR_PRIVATE_KEY required to operate Monoplasma, for 'commit' transactions.") }
    const privateKey = OPERATOR_PRIVATE_KEY.startsWith("0x") ? OPERATOR_PRIVATE_KEY : "0x" + OPERATOR_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "environment variable TOKEN_ADDRESS")

    const operatorAddress = wallet.address
    log(`Starting data union products server with operator address ${operatorAddress}...`)
    const config = {
        tokenAddress,
        operatorAddress,
        gasPrice: utils.parseUnits(GAS_PRICE_GWEI || "4", "gwei").toString(),
        finalityWaitSeconds: FINALITY_WAIT_SECONDS || 1000,
        streamrWsUrl: STREAMR_WS_URL,
        streamrHttpUrl: STREAMR_HTTP_URL,
    }
    const server = new DataUnionServer(wallet, storeDir, config, log, error)
    await server.start()

    if (WEBSERVER_PORT) {
        log("Starting web server...")
        const port = WEBSERVER_PORT
        const serverURL = `http://localhost:${port}`
        const app = express()
        app.use(morgan("combined"))
        app.use(cors())
        app.use(bodyParser.json({limit: "50mb"}))

        app.get("/config", (req, res) => { res.send(config) }) // TODO: remove

        const serverRouter = getServerRouter(server)
        app.use("/", serverRouter)

        app.listen(port, () => log(`Web server started at ${serverURL}`))

        // TODO: remove after 0.2 refactor is done
        if (DEVELOPER_MODE) {
            await sleep(200)

            log("DEVELOPER MODE: /admin endpoints available: addRevenue, deploy, addTo/{address}")
            const streamrNodeAddress = process.env.STREAMR_NODE_ADDRESS || "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c" // node address in docker dev environment
            const adminFee = process.env.ADMIN_FEE || 0

            // deploy new dataUnions
            app.use("/admin/deploy", (req, res) => deployContract(wallet, wallet.address, tokenAddress, streamrNodeAddress, BLOCK_FREEZE_SECONDS || 1000, adminFee, config.streamrWsUrl, config.streamrHttpUrl).then(({contract: { address }}) => res.send({ address })).catch(error => res.status(500).send({error})))
            app.use("/admin/addTo/:dataUnionAddress", (req, res) => transfer(wallet, req.params.dataUnionAddress, tokenAddress).then(tr => res.send(tr)).catch(error => res.status(500).send({error})))

            // deploy a test DataunionVault and provide direct manipulation endpoints for it (useful for seeing if anything is happening)
            const contract = await deployContract(wallet, wallet.address, tokenAddress, streamrNodeAddress, BLOCK_FREEZE_SECONDS || 1000, adminFee, config.streamrWsUrl, config.streamrHttpUrl)
            const dataUnionAddress = contract.address
            app.use("/admin/addRevenue", (req, res) => transfer(wallet, dataUnionAddress, tokenAddress).then(tr => res.send(tr)).catch(error => res.status(500).send({error})))
            app.use("/admin/setAdminFee", (req, res) => setFee(wallet, dataUnionAddress, "0.3").then(tr => res.send(tr)).catch(error => res.status(500).send({error})))
            app.use("/admin/resetAdminFee", (req, res) => setFee(wallet, dataUnionAddress, 0).then(tr => res.send(tr)).catch(error => res.status(500).send({error})))

            log(`Deployed DataunionVault contract at ${dataUnionAddress}, waiting for server to notice...`)
            await server.dataUnionIsRunning(dataUnionAddress)
            await sleep(500)

            log("Adding members...")
            const streamId = await contract.joinPartStream()
            const channel = new Channel(streamId, config.streamrWsUrl, config.streamrHttpUrl)
            await channel.startServer(wallet.privateKey)
            await channel.publish("join", [
                wallet.address,
                "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
                "0x4178babe9e5148c6d5fd431cd72884b07ad855a0",
            ])
            log("Waiting for server to notice joins...")
            while (server.dataUnions[dataUnionAddress].operator.watcher.plasma.members.length > 1) {
                await sleep(1000)
            }

            log("Transferring tokens to the contract...")
            await transfer(wallet, dataUnionAddress, tokenAddress)

            // this is here just so it's easy to add a breakpoint and inspect this scope
            for (;;) {
                await sleep(1000)
            }
        }
    }

    log("[DONE]")
}

const ERC20Mintable = require("../build/ERC20Mintable.json")
async function transfer(wallet, targetAddress, tokenAddress, amount) {
    throwIfBadAddress(targetAddress, "token transfer target address")
    // TODO: null token address => attempt ether transfer?
    await throwIfNotContract(wallet.provider, tokenAddress, "token address")
    const token = new Contract(tokenAddress, ERC20Mintable.abi, wallet)
    const tx = await token.transfer(targetAddress, amount || parseEther("1"))
    const tr = await tx.wait(1)
    return tr
}

const DataUnion = require("../build/DataunionVault")
async function setFee(wallet, targetAddress, fee) {
    throwIfNotContract(targetAddress, "Monoplasma contract address")
    if (!(fee >= 0 && fee <= 1)) { throw new Error(`Admin fee must be a number between 0...1, got: ${fee}`) }
    const dataUnion = new Contract(targetAddress, DataUnion.abi, wallet)
    const feeBN = parseEther(fee.toString())
    const tx = await dataUnion.setAdminFee(feeBN)
    const tr = await tx.wait(1)
    return tr
}

start().catch(error)
