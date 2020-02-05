const StreamrClient = require("streamr-client")
const sleep = require("../src/utils/sleep-promise")
const fetch = require("node-fetch")

const {
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { formatEther, parseEther, hexlify },
    Wallet,
    Contract,
} = require("ethers")

const TokenJson = require("../build/ERC20Detailed.json")
const MarketplaceAbi = require("../build/Marketplace.json")
//const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    BUYER_WALLET_PRIVATE_KEY,

    TOKEN_ADDRESS,
    MARKETPLACE_ADDRESS,
    COMMUNITY_ADDRESS,
    SECRET,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    JOINS_PER_MINUTE_AVERAGE,
    PURCHASES_PER_MINUTE,
    PURCHASE_SUBSCRIPTION_LENGTH_SECS_MIN,
    PURCHASE_SUBSCRIPTION_LENGTH_SECS_MAX,

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

let tokenContract
let marketplaceContract
let wallet
let lastJoin = Date.now()
let lastPurchase = Date.now()

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
    const marketplaceAddress = await throwIfNotContract(provider, MARKETPLACE_ADDRESS, "env variable MARKETPLACE_ADDRESS")

    const privateKey = BUYER_WALLET_PRIVATE_KEY.startsWith("0x") ? BUYER_WALLET_PRIVATE_KEY : "0x" + BUYER_WALLET_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    wallet = new Wallet(privateKey, provider)

    tokenContract = new Contract(tokenAddress, TokenJson.abi, wallet)
    marketplaceContract = new Contract(marketplaceAddress, MarketplaceAbi, wallet)

    while (true) {
        await tick()
        await sleep(TICK_RATE_MS)
    }
}

async function tick() {
    // Handle member joins
    const lastJoinDiff = Date.now() - lastJoin
    const joinProbability = JOINS_PER_MINUTE_AVERAGE * (lastJoinDiff / (60 * 1000)) * (TICK_RATE_MS / (60 * 1000))

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
    const lastPurchaseDiff = Date.now() - lastPurchase
    const purchaseProbability = PURCHASES_PER_MINUTE * (lastPurchaseDiff / (60 * 1000)) * (TICK_RATE_MS / (60 * 1000))

    if (Math.random() < purchaseProbability) {
        const productId = await findProductForCommunity(COMMUNITY_ADDRESS)
        if (productId) {
            const subscriptionLength = getRandomInt(PURCHASE_SUBSCRIPTION_LENGTH_SECS_MIN, PURCHASE_SUBSCRIPTION_LENGTH_SECS_MAX)
            await buyProduct(productId, subscriptionLength)
            lastPurchase = Date.now()
        } else {
            log("Could not find marketplace product id for community. Is the product published?")
        }
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
    const tx = await tokenContract.transfer(communityAddress, dataWeiAmount)
    log(`Transferring ${formatEther(dataWeiAmount)} DATA from ${wallet.address} to ${communityAddress}`)
    const tr = await tx.wait(1)
    log(`TX completed with hash ${tr.transactionHash}`)
    return tr
}

async function buyProduct(productId, subscriptionTimeInSeconds) {
    const hexProductId = hexlify("0x" + productId)
    const product = await marketplaceContract.getProduct(hexProductId)
    const pricePerSec = product[3]
    const allowance = pricePerSec * subscriptionTimeInSeconds
    const approveTx = await tokenContract.approve(MARKETPLACE_ADDRESS, parseEther(allowance.toString()))
    await approveTx.wait(1)

    log(`Buying product ${hexProductId} for ${subscriptionTimeInSeconds} seconds`)
    const tx = await marketplaceContract.buy(hexProductId, subscriptionTimeInSeconds)
    const tr = await tx.wait(1)
    log("Buy TX completed with hash " + tx.hash)
    return tr
}

async function findProductForCommunity(communityAddress) {
    const products = await fetch(`${STREAMR_HTTP_URL}/products?publicAccess=true`).then(resp => resp.json())
    if (products && Array.isArray(products)) {
        const product = products.find(p => p.beneficiaryAddress && p.beneficiaryAddress.toLowerCase() === communityAddress.toLowerCase())
        if (product) {
            return product.id
        }
    }

    return null
}

function getRandomInt(min, max) {
    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(Math.random() * (max - min)) + min
}

process
    .on("unhandledRejection", (reason, p) => {
        console.error(reason, "Unhandled Rejection at Promise", p)
    })
    .on("uncaughtException", err => {
        console.error(err, "Uncaught Exception thrown")
        process.exit(1)
    })

start().catch(error)
