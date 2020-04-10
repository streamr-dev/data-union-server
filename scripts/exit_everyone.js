require("dotenv/config")

const fs = require("fs")

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
const DataunionJson = require("../build/DataunionVault.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    ETHEREUM_PRIVATE_KEYS,      // comma-separated list

    DATAUNION_ADDRESS,
    GAS_PRICE_GWEI,
    MIN_WITHDRAWABLE_EARNINGS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    SLEEP_MS,                   // set this to zero for automatic runs

    MEMBERS_CACHE_FILE,

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

const ethersOptions = {}
if (GAS_PRICE_GWEI) {
    ethersOptions.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

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

    const dataunionAddress = await throwIfNotContract(provider, DATAUNION_ADDRESS, "env variable DATAUNION_ADDRESS")

    const rawKeys = [ETHEREUM_PRIVATE_KEY].concat((ETHEREUM_PRIVATE_KEYS || "").split(",")).filter(x => x)
    if (rawKeys.length < 1) {
        throw new Error("Must set in environment at least one ETHEREUM_PRIVATE_KEY or a comma-separated list of ETHEREUM_PRIVATE_KEYS")
    }
    const wallets = rawKeys.map(key => new Wallet(key, provider))   // throws "Error: invalid private key" on bad keys

    log(`Checking DataunionVault contract at ${dataunionAddress}...`)
    const dataunion = new Contract(dataunionAddress, DataunionJson.abi, wallets[0])
    const getters = DataunionJson.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    for (const getter of getters) {
        log(`  ${getter}: ${await dataunion[getter]().catch(e => e.message)}`)
    }

    const _tokenAddress = await dataunion.token()
    const tokenAddress = await throwIfNotContract(provider, _tokenAddress, `DataunionVault(${dataunionAddress}).token`)

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenJson.abi, wallets[0])
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    log("Connecting to Streamr...")
    const opts = { auth: { privateKey: ETHEREUM_PRIVATE_KEY } }
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    let totalBN = new BigNumber("0")
    let members
    if (MEMBERS_CACHE_FILE && fs.existsSync(MEMBERS_CACHE_FILE)) {
        const membersBuf = fs.readFileSync(MEMBERS_CACHE_FILE)
        members = JSON.parse(membersBuf)
    } else {
        members = await client.getMembers(dataunionAddress)
        for (let i = 0; i < members.length; i++) {
            const member = members[i]
            const stats = await client.getMemberStats(dataunionAddress, member.address)
            const earningsBN = new BigNumber(stats.withdrawableEarnings)
            const withdrawnBN = await dataunion.withdrawn(member.address)
            member.unwithdrawnEarningsBN = earningsBN.sub(withdrawnBN)
            member.proof = stats.proof
            member.withdrawableBlockNumber = stats.withdrawableBlockNumber
            totalBN = totalBN.add(member.unwithdrawnEarningsBN)
            log(`member ${i}/${members.length}: ${member.address}`)
            log(`  Previously withdrawn earnings:   ${withdrawnBN.toString()}`)
            log(`  Previously unwithdrawn earnings: ${member.unwithdrawnEarningsBN.toString()}`)
        }
    }
    members = members.filter(function(a) {
        return +a.unwithdrawnEarningsBN >= (MIN_WITHDRAWABLE_EARNINGS ? +MIN_WITHDRAWABLE_EARNINGS : 1)
    }).sort(function(a,b) {
        return +b.unwithdrawnEarningsBN - +a.unwithdrawnEarningsBN
    })

    if (members.length < 1) {
        log("No members with earnings to withdraw")
        log("[DONE]")
        return
    }

    if (MEMBERS_CACHE_FILE) {
        const membersString = JSON.stringify(members)
        fs.writeFileSync(membersString, MEMBERS_CACHE_FILE)
    }

    // estimate and show a summary of costs and sample of tx to be executed
    const gasBN = await dataunion.estimate.withdrawAllFor(
        members[0].address,
        members[0].withdrawableBlockNumber,
        members[0].unwithdrawnEarningsBN,
        members[0].proof
    )
    const priceBN = ethersOptions.gasPrice || parseUnits(10, "gwei")
    const feeBN = gasBN.mul(priceBN)
    const totalFeeBN = feeBN.mul(members.length)
    log(`Sending ${members.length} withdraw tx, for total value of ${formatEther(totalBN)} DATA`)
    log(`Paying approx ${formatEther(totalFeeBN)}ETH for gas, or ${formatEther(feeBN)}ETH/tx`)
    log("ADDRESS                                     DATA")
    //   0x0000000000000000000000000000000000000000  0.000000000000000000
    for (const member of members.slice(0, 5)) { log(`${member.address}  ${formatEther(member.unwithdrawnEarningsBN)}`) }
    if (members.length > 5) { log("...                                         ...") }
    if (sleepMs) {
        log(`Sleeping ${sleepMs}ms, please check the values and hit Ctrl+C if you're in the least unsure`)
        await sleep(sleepMs)
    }

    // split the members in batches and send them in parallel, one at a time from each wallet
    const contracts = wallets.map(w => new Contract(dataunionAddress, DataunionJson.abi, w))
    // TODO: more functional:
    // members.forChunks(contracts.length, members => {
    //    const receipts = await Promise.all(contracts.map(c => {
    for (let i = 0; i < members.length; i++) {
        const trPromises = []
        for (let j = 0; i < members.length && j < contracts.length; i++, j++) {
            const member = members[i]
            const contract = contracts[j]

            log(`Withdrawing ${formatEther(member.unwithdrawnEarningsBN)} DATA on behalf of ${member.address}...`)
            const tx = await contract.withdrawAllFor(
                member.address,
                member.withdrawableBlockNumber,
                member.unwithdrawnEarningsBN,
                member.proof,
                ethersOptions
            )

            log(`Follow transaction at https://etherscan.io/tx/${tx.hash}`)
            trPromises.push(tx.wait(1))
        }
        const receipts = await Promise.all(trPromises)
        log(`Receipts: ${JSON.stringify(receipts)}`)
    }

    log("[DONE]")
}

start().catch(error)
