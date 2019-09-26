const {
    Contract,
    getDefaultProvider,
    Wallet,
    utils: { getAddress },
    providers: { JsonRpcProvider }
} = require("ethers")

const deployCommunity = require("../src/utils/deployCommunity")
const { throwIfNotContract, throwIfBadAddress } = require("../src/utils/checkArguments")

const TokenJson = require("../build/ERC20Detailed.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    TOKEN_ADDRESS,
    BLOCK_FREEZE_SECONDS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    //GAS_PRICE_GWEI,   // TODO: include?
    OPERATOR_ADDRESS,
    STREAMR_NODE_ADDRESS,
    ADMIN_FEE,
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
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    try {
        const url = provider.connection ? provider.connection.url : provider.providers[0].connection.url
        log(`Connecting to ${url}`)
    } catch (e) { /*ignore*/ }
    const network = await provider.getNetwork()

    const operatorAddress = throwIfBadAddress(OPERATOR_ADDRESS, "env variable OPERATOR_ADDRESS")
    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")
    const streamrNodeAddress = getAddress(STREAMR_NODE_ADDRESS) || "0xc0aa4dC0763550161a6B59fa430361b5a26df28C" // node address in production
    const blockFreezeSeconds = BLOCK_FREEZE_SECONDS ? +BLOCK_FREEZE_SECONDS : 3600
    const adminFee = Number.parseFloat(ADMIN_FEE) || 0

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log("Checking token info...")
    const token = new Contract(TOKEN_ADDRESS, TokenJson.abi, provider)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    const contract = await deployCommunity(wallet, operatorAddress, tokenAddress, streamrNodeAddress, blockFreezeSeconds, adminFee, log, STREAMR_WS_URL, STREAMR_HTTP_URL)
    const joinPartStreamId = await contract.joinPartStream()

    log(`Deployed community contract at ${contract.address}`)
    log(`Network was ${JSON.stringify(network)}`)
    log(`JoinPartStream ID: ${joinPartStreamId}`)
    log("[DONE]")
}

start().catch(error)
