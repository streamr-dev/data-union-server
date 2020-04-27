#!/usr/bin/env node

require("dotenv/config")

const {
    Contract,
    getDefaultProvider,
    utils: { formatEther, BigNumber },
    providers: { JsonRpcProvider },
} = require("ethers")

const StreamrClient = require("streamr-client")

const { throwIfNotContract, throwIfSetButNotContract, throwIfSetButBadAddress } = require("../src/utils/checkArguments")

const TokenContract = require("../build/contracts/TestToken")
const DataUnionContract = require("../build/contracts/DataunionVault.json")

const {
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers

    DATAUNION_ADDRESS,
    STREAMR_NODE_ADDRESS,

    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    QUIET,
} = process.env

const log = QUIET ? () => {} : (...args) => {
    console.log(...args)
}
const error = (e, ...args) => {
    console.error(e.stack, ...args)
    process.exit(1)
}

const lastArg = process.argv.pop()
const dataUnionAddressArg = lastArg.endsWith("check_dataunion.js") ? "" : lastArg

async function start() {
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)
    const network = await provider.getNetwork().catch(e => {
        throw new Error(`Connecting to Ethereum failed, env ETHEREUM_SERVER=${ETHEREUM_SERVER} ETHEREUM_NETWORK=${ETHEREUM_NETWORK}`, e)
    })
    log("Connected to Ethereum network: ", JSON.stringify(network))

    const dataUnionAddress =
        await throwIfSetButNotContract(provider, dataUnionAddressArg, "command-line argument (DataunionVault contract Ethereum address)") ||
        await throwIfNotContract(provider, DATAUNION_ADDRESS, "env variable DATAUNION_ADDRESS")
    const streamrNodeAddress = await throwIfSetButBadAddress(STREAMR_NODE_ADDRESS, "env variable STREAMR_NODE_ADDRESS")

    log(`Checking DataunionVault contract at ${dataUnionAddress}...`)
    const dataUnion = new Contract(dataUnionAddress, DataUnionContract.abi, provider)
    const getters = DataUnionContract.abi.filter(f => f.constant && f.inputs.length === 0).map(f => f.name)
    const dataUnionProps = {}
    for (const getter of getters) {
        dataUnionProps[getter] = await dataUnion[getter]()
        log(`  ${getter}: ${dataUnionProps[getter]}`)
    }

    const _tokenAddress = await dataUnion.token()
    const tokenAddress = await throwIfNotContract(provider, _tokenAddress, `DataunionVault(${dataUnionAddress}).token()`)

    log(`Checking token contract at ${tokenAddress}...`)
    const token = new Contract(tokenAddress, TokenContract.abi, provider)
    log("  Token name: ", await token.name())
    log("  Token symbol: ", await token.symbol())
    log("  Token decimals: ", await token.decimals())

    log("Connecting to Streamr...")
    const opts = {}
    if (STREAMR_WS_URL) { opts.url = STREAMR_WS_URL }
    if (STREAMR_HTTP_URL) { opts.restUrl = STREAMR_HTTP_URL }
    const client = new StreamrClient(opts)

    log("Data union stats from server")
    const stats = await client.getdataUnionStats(dataUnion.address)
    log(`  Members: ${stats.memberCount.active} active / ${stats.memberCount.total} total`)
    log(`  Latest unfrozen block: ${stats.latestWithdrawableBlock.blockNumber} (${stats.latestWithdrawableBlock.memberCount} members)`)
    log(`  Total earnings received: ${formatEther(stats.totalEarnings)}`)

    const expectedBalance = dataUnionProps.totalWithdrawn.sub(stats.totalEarnings).mul(-1)
    const dataUnionBalance = await token.balanceOf(dataUnion.address)
    const diff = dataUnionBalance.sub(expectedBalance)
    log(`  Total withdrawn from contract: ${formatEther(dataUnionProps.totalWithdrawn)}`)
    log(`  Earnings - withdrawn: ${formatEther(expectedBalance)}`)
    log(`  Contract balance: ${formatEther(dataUnionBalance)}`)
    log(`  => Difference: ${formatEther(diff)}`)
    if (diff.lt(0)) {
        log("!!! TOKENS MISSING FROM CONTRACT !!!")
    }

    // check EE can write into joinPartStream
    if (streamrNodeAddress) {
        log(`  Streamr node address: ${streamrNodeAddress}`)    // TODO: add endpoint for asking this from EE
        const joinPartStreamId = dataUnionProps.joinPartStream
        log(`Checking joinPartStream ${joinPartStreamId}...`)
        const stream = await client.getStream(joinPartStreamId)
        try {
            const writers = await client.getStreamPublishers(joinPartStreamId)
            log("  Writers:")
            for (const wa of writers) {
                log("    " + wa)
            }
            const na = writers.find(a => a.toLowerCase() === streamrNodeAddress.toLowerCase())
            if (na) {
                log("  Streamr node can write")
                if (na !== streamrNodeAddress) {
                    log("  THE CASE IS WRONG THOUGH, that could be a problem")
                }
            } else {
                log("!!! STREAMR NODE NEEDS WRITE PERMISSION, otherwise joins and parts won't work !!!")
            }
        } catch (e) {
            if (e.message.includes("403")) {
                log(`  Couldn't get publishers, no read permission: ${e.body}`)
            } else {
                log(`  Error getting permissions: ${e.body}`)
            }
        }

        try {
            const perms = await stream.getPermissions()
            log(`  Permissions: ${JSON.stringify(perms)}`)
            const nodeWritePerm = perms.find(p => p.operation === "write" && p.user === streamrNodeAddress)
            if (nodeWritePerm) {
                log("  Streamr node has write permission")
            } else {
                log("!!! STREAMR NODE NEEDS WRITE PERMISSION, otherwise joins and parts won't work !!!")
            }
        } catch (e) {
            if (e.message.includes("403")) {
                log(`  Couldn't get permissions, we're not an owner (with share permission): ${e.body}`)
            } else {
                log(`  Error getting permissions: ${e.body}`)
            }
        }
    }

    log("Listing all members... (NB: withdrawableEarnings isn't displayed, use check_member.js for that)")
    // TODO: use client once withdraw is available from NPM
    //const memberList = await client.getMembers(dataUnionAddress)
    const memberList = await getMembers(dataUnionAddress)
    let sumOfEarnings = new BigNumber(0)
    for (const {address, earnings} of memberList) {
        sumOfEarnings = sumOfEarnings.add(earnings)
        const withdrawn = await dataUnion.withdrawn(address)
        const balance = withdrawn.sub(earnings).mul(-1)
        log(`  ${address}`)
        log(`    Server: Total earnings: ${formatEther(earnings)}`)
        log(`    Contract: Withdrawn earnings: ${formatEther(withdrawn)}`)
        log(`    => Balance: ${formatEther(balance)}`)
        if (balance.lt(0)) {
            log("!!! NEGATIVE BALANCE !!!")
        }
    }
    log(`Sum of members' earnings: ${formatEther(sumOfEarnings)}`)
    log(`Total earnings for the dataUnion: ${formatEther(stats.totalEarnings)}`)
    log("[DONE]")
}

start().catch(error)

const fetch = require("node-fetch")
async function getMembers(dataUnionAddress) {
    const url = `${STREAMR_HTTP_URL || "https://streamr.network/api/v1"}/dataunions/${dataUnionAddress}/members`
    return fetch(url).then((res) => res.json())
}
