const StreamrClient = require("streamr-client")
const sleep = require("../src/utils/sleep-promise")

const {
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { formatEther, parseEther },
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

const TICK_RATE_MS = 10 * 1000

const log = QUIET ? () => {} : (...args) => {
    console.log(`${new Date().toISOString()} -`, ...args)
}
const error = (e, ...args) => {
    console.error(`${new Date().toISOString()} -`, e.stack, ...args)
    process.exit(1)
}

const { throwIfBadAddress, throwIfNotContract } = require("../src/utils/checkArguments")

let token
let wallet
let lastJoin = Date.now()
let lastTransfer = Date.now()

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
    await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")
    const tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "env variable TOKEN_ADDRESS")

    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    wallet = new Wallet(privateKey, provider)

    token = new Contract(tokenAddress, TokenJson.abi, wallet)

    while (true) {
        tick()
        await sleep(TICK_RATE_MS)
    }
}

async function tick() {
    // Handle member joins
    const lastJoinDiff = Date.now() - lastJoin
    const joinProbability = JOINS_PER_MINUTE_AVERAGE * (lastJoinDiff / (60 * 1000))

    if (Math.random() < joinProbability) {
        let secret = SECRET

        // ~10% chance to leave secret out se we get a join request with state PENDING
        if (Math.random() < 0.1) {
            secret = undefined
            log("Adding PENDING join request without SECRET")
        }

        await joinRandom(COMMUNITY_ADDRESS, secret)
        lastJoin = Date.now()
    }

    // TODO: Handle member parts when StreamrClient supports them....
    
    // Handle buys
    const lastTransferDiff = Date.now() - lastTransfer
    const transferAmount = REVENUE_PER_MINUTE * (lastTransferDiff / (60 * 1000))

    if (transferAmount > REVENUE_PER_TRANSFER) {
        await sendTokens(COMMUNITY_ADDRESS, transferAmount)
        lastTransfer = Date.now()
    }
}

async function joinRandom(communityAddress, secret) {
    if (!communityAddress) { throw new Error("communityAddress not initialized") }

    const newWallet = Wallet.createRandom()
    const memberAddress = newWallet.address
    throwIfBadAddress(memberAddress, "join function argument memberAddress")

    log("Creating StreamrClient with randomly created privateKey")
    const opts = { auth: { privateKey: newWallet.privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const walletClient = new StreamrClient(opts)

    log(`Adding member ${memberAddress} to community ${communityAddress}`)
    const res = await walletClient.joinCommunity(communityAddress, memberAddress, secret)
    return res
}

async function sendTokens(communityAddress, dataAmount) {
    const dataWeiAmount = parseEther(dataAmount.toString())
    const tx = await token.transfer(communityAddress, dataWeiAmount)
    log(`Transferring ${formatEther(dataWeiAmount)} DATA from ${wallet.address} to ${communityAddress}`)
    const tr = await tx.wait(1)
    log(`TX completed with hash ${tr.transactionHash}`)
    return tr
}

start().catch(error)
