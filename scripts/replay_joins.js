#!/usr/bin/env node

require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
} = require("ethers")

const CommunityProductJson = require("../build/DataunionVault.json")

const { throwIfNotContract } = require("../src/utils/checkArguments")

const StreamrChannel = require("../src/streamrChannel")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    DATAUNION_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
} = process.env

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    //const network =
    await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    //console.log("Connected to Ethereum network: ", JSON.stringify(network))

    const contractAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "Environment variable DATAUNION_ADDRESS")

    const config = {
        contractAddress,
        streamrWsUrl: STREAMR_WS_URL,
        streamrHttpUrl: STREAMR_HTTP_URL,
    }

    const contract = new Contract(contractAddress, CommunityProductJson.abi, provider)

    const joinPartStreamId = await contract.joinPartStream()
    //const channel = new StreamrChannel(joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)
    const channel = new StreamrChannel(joinPartStreamId, config.streamrWsUrl, config.streamrHttpUrl)

    channel.on("join", addresses => {
        if (!Array.isArray(addresses)) {
            console.error("Bad join event: " + JSON.stringify(addresses))
            return
        }
        addresses.forEach(address => {
            console.log(address)
        })
    })
    setTimeout(() => process.exit(1), 10 * 60 * 1000)
    await channel.listen()

    await channel.close()
}

start().catch(console.error)
