const StreamrClient = require("streamr-client")

const {
    getDefaultProvider,
    providers: { JsonRpcProvider },
} = require("ethers")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    ETHEREUM_PRIVATE_KEY,
    COMMUNITY_ADDRESS,
    SECRET,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
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

    try {
        const url = provider.connection ? provider.connection.url : provider.providers[0].connection.url
        log(`Connecting to ${url}`)
    } catch (e) { /*ignore*/ }
    const network = await provider.getNetwork()

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }

    const communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    log(`Adding to https://streamr.com/api/v1/communities/${communityAddress}/secrets ...`)
    const res = await client.createSecret(communityAddress, SECRET)

    log(`Secret added successfully, response: ${JSON.stringify(res)}`)
    log(`Network was ${JSON.stringify(network)}`)
}

start().catch(error)
