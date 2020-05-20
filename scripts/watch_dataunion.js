#!/usr/bin/env node

require("dotenv/config")

const fs = require("mz/fs")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")
const os = require("os")

const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
} = require("ethers")

const DataUnionJson = require("../build/DataunionVault")

const FileStore = require("../src/fileStore")
const MonoplasmaWatcher = require("../src/watcher")
const { throwIfNotContract } = require("../src/utils/checkArguments")

const dataunionRouter = require("../src/routers/dataunion")
const StreamrChannel = require("../src/streamrChannel")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    DATAUNION_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    STORE_DIR,
    //RESET,

    WEBSERVER_PORT,
    QUIET,
} = process.env

const log = QUIET ? () => {} : console.log
const error = (e, ...args) => {
    console.error(e.stack, args)
    process.exit(1)
}

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    const contractAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "Environment variable DATAUNION_ADDRESS")
    const storeDir = STORE_DIR && fs.existsSync(STORE_DIR) ? STORE_DIR : `${os.tmpdir()}/watcher-store/${contractAddress}-${Date.now()}`
    const fileStore = new FileStore(storeDir)

    const config = {
        contractAddress,
        streamrWsUrl: STREAMR_WS_URL,
        streamrHttpUrl: STREAMR_HTTP_URL,
    }

    const contract = new Contract(contractAddress, DataUnionJson.abi, provider)

    const joinPartStreamId = await contract.joinPartStream()
    const channel = new StreamrChannel(joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)
    if (!await channel.isValid()) {
        throw new Error(`Faulty StreamrChannel("${joinPartStreamId}", "${config.streamrWsUrl}", "${config.streamrHttpUrl}")`)
    }

    log("Starting the MonoplasmaWatcher")
    const watcher = new MonoplasmaWatcher(provider, channel, fileStore)
    await watcher.start(config)

    log("Starting web server...")
    const port = WEBSERVER_PORT || 8080
    const serverURL = `http://localhost:${port}`
    const app = express()
    app.use(cors())
    app.use(bodyParser.json({limit: "50mb"}))
    app.use("/", dataunionRouter.setWatcher(watcher), dataunionRouter)
    app.get("/config", (req, res) => { res.send(config) })

    // TODO: these probably should not be part of "public HTTP server" of Data Unions
    app.get("/timestamps", (req, res) => { res.send(watcher.blockTimestampCache) })
    //app.use("/analytics", analysisRouter())

    app.listen(port, () => log(`Web server started at ${serverURL}`))
    log("[DONE]")
}

start().catch(error)
