const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider }
} = require("ethers")

const { throwIfNotContract } = require("../src/utils/checkArguments")

const TokenJson = require("../build/ERC20Detailed.json")
const CommunityJson = require("../build/CommunityProduct.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    COMMUNITY_ADDRESS,

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
    log(`Network is ${JSON.stringify(network)}`)

    const communityAddress = await throwIfNotContract(provider, COMMUNITY_ADDRESS, "env variable COMMUNITY_ADDRESS")

    log(`Checking community contract at ${communityAddress}...`)
    const community = new Contract(communityAddress, CommunityJson.abi, provider)
    const getters = CommunityJson.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    for (const getter of getters) {
        log(`  ${getter}: ${await community[getter]()}`)
    }

    const _tokenAddress = await community.token()
    const tokenAddress = await throwIfNotContract(provider, _tokenAddress, `community(${communityAddress}).token`)

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenJson.abi, provider)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())
}

start().catch(error)
