#!/usr/bin/env node

const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
} = require("ethers")

const CommunityProductJson = require("../build/CommunityProduct.json")

const { throwIfNotContract } = require("../src/utils/checkArguments")

const StreamrChannel = require("../src/streamrChannel")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    //COMMUNITY_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
} = process.env

const COMMUNITY_ADDRESS = "0xF24197f71fC9b2F4F4c24ecE461fB0Ff7C91FD23"

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    //const network =
    await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    //console.log("Connected to Ethereum network: ", JSON.stringify(network))

    const contractAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "Environment variable COMMUNITY_ADDRESS")

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
