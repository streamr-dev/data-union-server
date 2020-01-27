require("dotenv/config")

const StreamrClient = require("streamr-client")

const {
    utils: { computeAddress },
} = require("ethers")

const {
    ETHEREUM_PRIVATE_KEY,

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

async function start() {
    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const memberAddress = computeAddress(privateKey)

    log(`Connecting to Streamr as ${memberAddress}...`)
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    log("Disconnecting...")
    await client.ensureDisconnected()
}

start().catch(error)
