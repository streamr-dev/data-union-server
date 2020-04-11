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

    MAX_MEMBERS_TO_WITHDRAW,

    SLEEP_MS,                   // set this to zero for automatic runs

    MEMBERS_CACHE_FILE,
    WRITE_MEMBERS_CACHE,

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

    let txCount = 0
    let totalBN = new BigNumber("0")
    let members
    if (MEMBERS_CACHE_FILE && fs.existsSync(MEMBERS_CACHE_FILE)) {
        log(`Loading members from ${MEMBERS_CACHE_FILE}`)
        const membersBuf = fs.readFileSync(MEMBERS_CACHE_FILE)
        members = JSON.parse(membersBuf)
        // const membersObjects = JSON.parse(membersBuf)
        // members = membersObjects.map(m => ({
        //     address: m.address,
        //     withdrawableBlockNumber: m.withdrawableBlockNumber,
        //     earningsBN: new BigNumber(m.earningsBN),
        //     unwithdrawnEarningsBN: new BigNumber(m.unwithdrawnEarningsBN),
        //     proof: m.proof,
        // }))
        log(`Loaded ${members.length} members`)
    } else {
        members = await client.getMembers(dataunionAddress)
        const maxTxCount = MAX_MEMBERS_TO_WITHDRAW && MAX_MEMBERS_TO_WITHDRAW < members.length ? MAX_MEMBERS_TO_WITHDRAW : members.length
        for (let i = 0; i < members.length && txCount < maxTxCount; i++) { // TODO: do filtering already in this loop?
            const member = members[i]
            const stats = await client.getMemberStats(dataunionAddress, member.address)
            member.earningsBN = new BigNumber(stats.withdrawableEarnings)
            member.withdrawnBN = await dataunion.withdrawn(member.address)
            member.unwithdrawnEarningsBN = member.earningsBN.sub(member.withdrawnBN)
            member.proof = stats.proof
            member.withdrawableBlockNumber = stats.withdrawableBlockNumber
            totalBN = totalBN.add(member.unwithdrawnEarningsBN)
            log(`tx ${txCount + 1}, member ${i}/${members.length}: ${member.address}`)
            log(`  Previously withdrawn earnings:   ${member.withdrawnBN.toString()}`)
            log(`  Previously unwithdrawn earnings: ${member.unwithdrawnEarningsBN.toString()}`)
            if (+member.unwithdrawnEarningsBN >= (MIN_WITHDRAWABLE_EARNINGS ? +MIN_WITHDRAWABLE_EARNINGS : 1)) {
                txCount++
            } else {
                log("  SKIP")
            }
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

    if (WRITE_MEMBERS_CACHE && MEMBERS_CACHE_FILE) {
        const membersObjects = members.map(m => ({
            address: m.address,
            withdrawableBlockNumber: m.withdrawableBlockNumber,
            earningsBN: m.earningsBN.toString(),
            withdrawnBN: m.withdrawnBN.toString(),
            unwithdrawnEarningsBN: m.unwithdrawnEarningsBN.toString(),
            proof: m.proof,
        }))
        const membersString = JSON.stringify(membersObjects)
        fs.writeFileSync(MEMBERS_CACHE_FILE, membersString)
    }

    // estimate and show a summary of costs and sample of tx to be executed
    const lastMember = members[members.length - 1]
    const gasBN = await dataunion.estimate.withdrawAllFor(
        lastMember.address,
        lastMember.withdrawableBlockNumber,
        lastMember.earningsBN,
        lastMember.proof
    )
    txCount = MAX_MEMBERS_TO_WITHDRAW && MAX_MEMBERS_TO_WITHDRAW < members.length ? MAX_MEMBERS_TO_WITHDRAW : members.length
    const priceBN = ethersOptions.gasPrice || parseUnits(10, "gwei")
    ethersOptions.gasLimit = gasBN.mul(2)
    const feeBN = gasBN.mul(priceBN)
    const totalFeeBN = feeBN.mul(txCount)
    log(`Sending ${txCount} withdraw tx, for total value of ${formatEther(totalBN)} DATA`)
    log(`Paying approx ${formatEther(totalFeeBN)}ETH for gas, or ${formatEther(feeBN)}ETH/tx`)
    log("ADDRESS                                     DATA")
    //   0x0000000000000000000000000000000000000000  0.000000000000000000
    for (const member of members.slice(0, 5)) { log(`${member.address}  ${formatEther(member.unwithdrawnEarningsBN)}`) }
    if (txCount > 5) { log("...                                         ...") }
    if (sleepMs) {
        log(`Sleeping ${sleepMs}ms, please check the values and hit Ctrl+C if you're in the least unsure`)
        await sleep(sleepMs)
    }

    // split the members in batches and send them in parallel, one at a time from each wallet
    const contracts = wallets.map(w => new Contract(dataunionAddress, DataunionJson.abi, w))
    // TODO: more functional:
    // members.forChunks(contracts.length, members => {
    //    const receipts = await Promise.all(contracts.map(c => {
    for (let i = 0; i < txCount;) {
        const trPromises = []
        for (let j = 0; i < txCount && j < contracts.length; i++, j++) {
            const member = members[i]
            const contract = contracts[j]

            const withdrawnBN = await dataunion.withdrawn(member.address)
            if (!withdrawnBN.eq(member.withdrawnBN)) {
                log(`Mismatch in withdrawn earnings: Expected ${member.withdrawnBN.toString()}, got ${withdrawnBN.toString()}. SKIP ${member.address}`)
                j--         // skip, so select another member for this wallet
                continue
            }

            log(`tx ${i}/${txCount}: Withdrawing ${formatEther(member.unwithdrawnEarningsBN)} DATA on behalf of ${member.address}...`)
            const tx = await contract.withdrawAllFor(
                member.address,
                member.withdrawableBlockNumber,
                member.earningsBN,
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
