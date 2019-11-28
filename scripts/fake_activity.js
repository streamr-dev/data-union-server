const StreamrClient = require("streamr-client")

const {
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { computeAddress, formatEther },
    Wallet,
    Contract,
} = require("ethers")

const TokenJson = require("../build/ERC20Detailed.json")
//const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,

    TOKEN_ADDRESS,
    COMMUNITY_ADDRESS,
    SECRET,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    // join and parts, in fact, to keep the size of community around TARGET_SIZE
    JOINS_PER_MINUTE_AVERAGE,       // mean of sinusoidal frequency cycle
    JOINS_PER_MINUTE_VARIANCE,      // amplitude of sinusoidal frequency cycle
    JOINS_PER_MINUTE_CYCLE_HOURS,   // length of full cycle of sinusoidal frequency cycle
    TARGET_SIZE,                    // increase probability of parting after community size > TARGET_SIZE

    REVENUE_PER_MINUTE,             // average frequency, uniform 1/2 f ... 3/2 f
    REVENUE_PER_TRANSFER,           // average size, power law, capped at 100x

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

const { throwIfBadAddress, throwIfNotContract } = require("../src/utils/checkArguments")

let communityAddress
let token
let wallet
let client
async function start() {
    const provider =
        ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) :
        ETHEREUM_NETWORK ? getDefaultProvider(ETHEREUM_NETWORK) : null
    if (!provider) { throw new Error("Must supply either ETHEREUM_SERVER or ETHEREUM_NETWORK") }

    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    if (!SECRET) { throw new Error("Please specify env variable SECRET") }
    communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")
    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    wallet = new Wallet(privateKey, provider)

    token = new Contract(tokenAddress, TokenJson.abi, wallet)

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    client = new StreamrClient(opts)

    const memberAddress = computeAddress(privateKey)
    await join(memberAddress, SECRET)
    await sendTokens()

    log(`Network was ${JSON.stringify(network)}`)
}

async function join(memberAddress, secret) {
    if (!communityAddress) { throw new Error("communityAddress not initialized") }
    throwIfBadAddress(memberAddress, "join function argument memberAddress")
    log(`Adding https://streamr.com/api/v1/communities/${communityAddress}/members/${memberAddress} ...`)
    const res = await client.joinCommunity(communityAddress, memberAddress, secret)
    log(JSON.stringify(res))
    return res
}

async function sendTokens(dataWeiAmount) {
    const tx = await token.transfer(communityAddress, dataWeiAmount)
    log(`Transferring ${formatEther(dataWeiAmount)} DATA from ${wallet.address} to ${communityAddress}...`)
    const tr = await tx.wait(1)
    log(JSON.stringify(tr))
    return tr
}

start().catch(error)
