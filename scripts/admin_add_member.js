require("dotenv/config")

const StreamrClient = require("streamr-client")

const {
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { getAddress },
} = require("ethers")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    ETHEREUM_PRIVATE_KEY,
    DATAUNION_ADDRESS,
    MEMBER_LIST,                // comma-separated list of addresses

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
} = process.env

const log = require("debug")("Streamr::dataunion::scripts::join_dataunion")
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

const { throwIfNotContract } = require("../src/utils/checkArguments")


async function start() {
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    if (!ETHEREUM_PRIVATE_KEY) { throw new Error("Must set ETHEREUM_PRIVATE_KEY environment variable!") }
    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }

    const dataUnionAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "env variable DATAUNION_ADDRESS")

    const memberAddresses = MEMBER_LIST.split(",")
    if (memberAddresses.length < 1) {
        throw new Error("Please provide a comma-separated list of addresses in env var MEMBER_LIST")
    }

    const memberAddressList = memberAddresses.map(getAddress)

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    memberAddressList.forEach(memberAddress => {
        log(`Adding https://streamr.com/api/v1/dataunions/${dataUnionAddress}/members/${memberAddress} ...`)
    })
    const res = await client.addMembers(dataUnionAddress, memberAddressList, provider)

    log(`addMembers response: ${JSON.stringify(res)}`)
    log(`Network was ${JSON.stringify(network)}`)
    log("[DONE]")
    await client.ensureDisconnected()
}


start().catch(error)
