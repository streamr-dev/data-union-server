const {
    Contract,
    getDefaultProvider,
    Wallet,
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
    //GAS_PRICE_GWEI,   // TODO: include?
    OPERATOR_ADDRESS,
    QUIET,
} = process.env

const provider =
    ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
    ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
if (!provider) {
    throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK")
}


const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

async function start() {
    throwIfBadAddress(ETHEREUM_PRIVATE_KEY, "env variable ETHEREUM_PRIVATE_KEY")
    throwIfBadAddress(OPERATOR_ADDRESS, "env variable OPERATOR_ADDRESS")
    throwIfNotContract(TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")

    try {
        log(`Connecting to ${provider._network.name} network, ${provider.providers[0].connection.url}`)
    } catch (e) { /*ignore*/ }

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log("Checking token info...")
    const token = new Contract(TOKEN_ADDRESS, TokenJson.abi, provider)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    const blockFreezeSeconds = BLOCK_FREEZE_SECONDS ? +BLOCK_FREEZE_SECONDS : 3600
    await deployCommunity(wallet, OPERATOR_ADDRESS, TOKEN_ADDRESS, blockFreezeSeconds, log)
}

start().catch(error)
