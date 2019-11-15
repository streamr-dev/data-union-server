const {
    Contract,
    getDefaultProvider,
    Wallet,
    utils: { parseUnits, parseEther, formatEther, bigNumberify },
    providers: { JsonRpcProvider }
} = require("ethers")

const sleep = require("../src/utils/sleep-promise")
const { throwIfNotContract } = require("../src/utils/checkArguments")

const TokenJson = require("../build/ERC20Detailed.json")
const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,

    TOKEN_ADDRESS,
    COMMUNITY_ADDRESS,
    GAS_PRICE_GWEI,

    // only one of these two please...
    DATA_TOKEN_AMOUNT,
    DATA_WEI_AMOUNT,

    SLEEP_MS,                   // set this to zero for automatic runs

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

// sleep before executing, let user double-check values
const sleepMs = Number.isNaN(+SLEEP_MS) ? 5000 : +SLEEP_MS

async function start() {
    // TODO: move process.env parsing logic to a separate file
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")
    const communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")

    if (DATA_TOKEN_AMOUNT && DATA_WEI_AMOUNT || !DATA_TOKEN_AMOUNT && !DATA_WEI_AMOUNT) { throw new Error("Please specify either env variable DATA_TOKEN_AMOUNT or DATA_WEI_AMOUNT, but not both!") }
    const dataWeiAmount = DATA_WEI_AMOUNT ? bigNumberify(DATA_WEI_AMOUNT) : parseEther(DATA_TOKEN_AMOUNT)

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log(`Checking community contract at ${communityAddress}...`)
    const community = new Contract(communityAddress, CommunityJson.abi, provider)
    const getters = CommunityJson.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    for (const getter of getters) {
        log(`  ${getter}: ${await community[getter]()}`)
    }

    const communityTokenAddress = await community.token()
    if (communityTokenAddress !== tokenAddress) {
        // TODO: get tokenAddress from community if not explicitly given?
        throw new Error(`Mismatch: token address given was ${tokenAddress}, community expects ${communityTokenAddress}`)
    }

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenJson.abi, wallet)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    log(`Transferring ${formatEther(dataWeiAmount)} DATA from ${wallet.address} to ${communityAddress}...`)
    if (sleepMs) {
        log(`Sleeping ${sleepMs}ms, please check the values and hit Ctrl+C if you're in the least unsure`)
        await sleep(sleepMs)
    }

    const options = {}
    if (GAS_PRICE_GWEI) { options.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei") }
    const tx = await token.transfer(communityAddress, dataWeiAmount, options)
    log(`Follow transaction at https://etherscan.io/tx/${tx.hash}`)
    const tr = await tx.wait(1)
    log(`Receipt: ${JSON.stringify(tr)}`)
    log("[DONE]")
}

start().catch(error)
