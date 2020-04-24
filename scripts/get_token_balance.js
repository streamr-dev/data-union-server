const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
    Wallet,
} = require("ethers")

const { throwIfNotContract, throwIfBadAddress } = require("../src/utils/checkArguments")

const TokenContract = require("../build/ERC20Detailed.json")
const DataUnionContract = require("../build/DataunionVault.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    TOKEN_ADDRESS,              // give token address explicitly
    DATAUNION_ADDRESS,          // ...or get it from dataunion contract

    ETHEREUM_PRIVATE_KEY,       // either derive the address from key...
    MEMBER_ADDRESS,             // ...or get it directly
} = process.env

const log = require("debug")("Streamr::dataunion::script::get_token_balance")

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e.stack)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    let wallet
    if (ETHEREUM_PRIVATE_KEY) {
        const privateKey = ETHEREUM_PRIVATE_KEY.startsWith("0x") ? ETHEREUM_PRIVATE_KEY : "0x" + ETHEREUM_PRIVATE_KEY
        if (privateKey.length !== 66) { throw new Error("Malformed private key, must be 64 hex digits long (optionally prefixed with '0x')") }
        wallet = new Wallet(privateKey, provider)
    }
    const memberAddress = wallet && wallet.address || await throwIfBadAddress(MEMBER_ADDRESS, "env variable MEMBER_ADDRESS")

    let tokenAddress
    if (TOKEN_ADDRESS) {
        tokenAddress = await throwIfNotContract(provider, TOKEN_ADDRESS, "environment variable TOKEN_ADDRESS")
    } else {
        const dataUnionAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "env variable DATAUNION_ADDRESS")
        log(`Getting token address from DataunionVault at ${dataUnionAddress}`)
        const dataunion = new Contract(dataUnionAddress, DataUnionContract.abi, provider)
        tokenAddress = await throwIfNotContract(provider, await dataunion.token(), `DataunionVault(${dataUnionAddress}).token()`)
    }
    log(`Token at ${tokenAddress}`)
    const token = new Contract(tokenAddress, TokenContract.abi, provider)

    const balance = await token.balanceOf(memberAddress)
    log(`Balance of ${memberAddress} in token-wei`)
    console.log(balance.toString())
    log("[DONE]")
}

start().catch(e => { console.error(e.stack) })
