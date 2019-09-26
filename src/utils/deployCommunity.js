const {
    ContractFactory,
    utils: { BigNumber, parseUnits }
} = require("ethers")
const StreamrClient = require("streamr-client")

const { throwIfBadAddress, throwIfNotContract } = require("./checkArguments")

const CommunityJson = require("../../build/CommunityProduct")

/** @typedef {string} EthereumAddress */

/**
 * Deploy a new CommunityProduct contract and create the required joinPartStream
 * @param {Wallet} wallet to do the deployment from, also becomes owner or stream and contract
 * @param {EthereumAddress} operatorAddress community-product-server that should operate the contract
 * @param {EthereumAddress} tokenAddress
 * @param {Number} blockFreezePeriodSeconds security parameter against operator failure (optional, default: 0)
 * @param {Number} adminFee fraction of revenue that goes to product admin, 0...1 (optional, default: 0)
 * @param {Function} log
 */
async function deployCommunity(wallet, operatorAddress, tokenAddress, streamrNodeAddress, blockFreezePeriodSeconds = 0, adminFee = 0, log, streamrWsUrl, streamrHttpUrl, gasPriceGwei) {
    throwIfBadAddress(operatorAddress, "deployCommunity function argument operatorAddress")
    throwIfBadAddress(streamrNodeAddress, "deployCommunity function argument streamrNodeAddress")
    await throwIfNotContract(wallet.provider, tokenAddress, "deployCommunity function argument tokenAddress")

    if (adminFee < 0 || adminFee > 1) { throw new Error("Admin fee must be a number between 0...1, got: " + adminFee) }
    const adminFeeBN = new BigNumber((adminFee * 1e18).toFixed())   // last 2...3 decimals are going to be gibberish

    const joinPartStreamName = `Join-Part-${wallet.address.slice(0, 10)}-${Date.now()}`

    log && log(`Creating joinPartStream (name = ${joinPartStreamName})...`)
    const privateKey = wallet.privateKey
    const opts = { auth: { privateKey } }
    if (streamrWsUrl) { opts.url = streamrWsUrl }
    if (streamrHttpUrl) { opts.restUrl = streamrHttpUrl }
    const client = new StreamrClient(opts)
    const stream = await client.getOrCreateStream({ name: joinPartStreamName })

    // every watcher should be able to read joins and parts in order to sync the state
    const res1 = await stream.grantPermission("read", null)
    log && log("Grant public read", JSON.stringify(res1))

    // streamrNode must be able to handle accepted JoinRequests
    const res2 = await stream.grantPermission("write", streamrNodeAddress)
    log && log("Grant E&E write", JSON.stringify(res2))

    const options = {}
    if (gasPriceGwei) { options.gasPrice = parseUnits(gasPriceGwei, "gwei") }

    log && log(`Deploying root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds}, joinPartStream = ${stream.id}, adminFee = ${adminFee})...`)
    const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, stream.id, tokenAddress, blockFreezePeriodSeconds, adminFeeBN, options)
    log && log(`Will be deployed @ ${result.address}, follow deployment: https://etherscan.io/tx/${result.deployTransaction.hash}`)
    await result.deployed()
    return result
}

module.exports = deployCommunity
