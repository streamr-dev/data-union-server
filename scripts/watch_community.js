#!/usr/bin/env node

const fs = require("mz/fs")
const path = require("path")
const express = require("express")
const cors = require("cors")
const bodyParser = require("body-parser")

const {
    Contract,
    getDefaultProvider,
    utils: { getAddress, parseUnits },
    providers: { JsonRpcProvider },
} = require("ethers")

const CommunityProductJson = require("../build/CommunityProduct.json")

const FileStore = require("monoplasma/src/fileStore")
const MonoplasmaWatcher = require("../src/watcher")
const { throwIfBadAddress, throwIfSetButNotContract, throwIfNotContract } = require("../src/utils/checkArguments")

//const getCommunitiesRouter = require("../src/routers/communities")
const getMemberRouter = require("monoplasma/src/routers/member")
const StreamrChannel = require("../src/streamrChannel")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    //COMMUNITY_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    STORE_DIR,
    //RESET,

    WEBSERVER_PORT,
    QUIET,
} = process.env

const COMMUNITY_ADDRESS = "0xF24197f71fC9b2F4F4c24ecE461fB0Ff7C91FD23"

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

    const contractAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "Environment variable COMMUNITY_ADDRESS")
    const storeDir = fs.existsSync(STORE_DIR) ? STORE_DIR : `${__dirname}/store/${contractAddress}-${Date.now()}`
    const fileStore = new FileStore(storeDir)

    const config = {
        contractAddress,
        streamrWsUrl: STREAMR_WS_URL,
        streamrHttpUrl: STREAMR_HTTP_URL,
    }

    const contract = new Contract(contractAddress, CommunityProductJson.abi, provider)

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
    app.use("/api", getMemberRouter(watcher.plasma.getMemberApi()))
    app.get("/config", (req, res) => { res.send(config) })
    //app.use("/analytics", analysisRouter())

    app.listen(port, () => log(`Web server started at ${serverURL}`))
    log("[DONE]")
}

start().catch(error)
