require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    Wallet,
    utils: { parseUnits, formatEther, BigNumber },
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrClient = require("streamr-client")

const sleep = require("../src/utils/sleep-promise")
const { throwIfNotContract } = require("../src/utils/checkArguments")

const TokenJson = require("../build/ERC20Detailed.json")
const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,

    COMMUNITY_ADDRESS,
    GAS_PRICE_GWEI,
    MIN_WITHDRAWABLE_EARNINGS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

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

    const communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")
    const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
    if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
    const wallet = new Wallet(privateKey, provider)

    log(`Checking community contract at ${communityAddress}...`)
    const community = new Contract(communityAddress, CommunityJson.abi, wallet)
    const getters = CommunityJson.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    for (const getter of getters) {
        log(`  ${getter}: ${await community[getter]()}`)
    }

    const _tokenAddress = await community.token()
    const tokenAddress = await throwIfNotContract(provider, _tokenAddress, `community(${communityAddress}).token`)

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenJson.abi, wallet)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    let members = await client.getMembers(communityAddress)
    for (const member of members){
        const stats = await client.getMemberStats(communityAddress, member.address)
        const earningsBN = new BigNumber(stats.withdrawableEarnings)
        const withdrawnBN = await community.withdrawn(member.address)
        member.unwithdrawnEarningsBN = earningsBN.sub(withdrawnBN)
        member.stats = stats
        log(`member: ${member.address}`)
        log(`  Previously withdrawn earnings: ${withdrawnBN.toString()}`)
        log(`  Previously unwithdrawn earnings: ${member.unwithdrawnEarningsBN.toString()}`)
    }
    members = members.filter(function(a){
        return +a.unwithdrawnEarningsBN >= (MIN_WITHDRAWABLE_EARNINGS ? +MIN_WITHDRAWABLE_EARNINGS : 1)
    }).sort(function(a,b){
        return +b.unwithdrawnEarningsBN - +a.unwithdrawnEarningsBN
    })
    log(`Members to withdraw: ${JSON.stringify(members)}`)

    for (const member of members){
        const options = {}
        if (GAS_PRICE_GWEI) { options.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei") }

        log(`Withdrawing ${formatEther(member.unwithdrawnEarningsBN)} DATA from ${communityAddress} to ${wallet.address}...`)
        if (sleepMs) {
            log(`Sleeping ${sleepMs}ms, please check the values and hit Ctrl+C if you're in the least unsure`)
            await sleep(sleepMs)
        }
        
        const tx = await community.withdrawAllFor(
            member.address,
            member.stats.withdrawableBlockNumber,
            member.unwithdrawnEarningsBN,
            member.stats.proof,
            options
        )
    
        log(`Follow transaction at https://etherscan.io/tx/${tx.hash}`)
        const tr = await tx.wait(1)
        log(`Receipt: ${JSON.stringify(tr)}`)
        log("[DONE]")
        
        
    }
}

start().catch(error)
