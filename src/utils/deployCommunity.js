const { ContractFactory } = require("ethers")
const StreamrClient = require("streamr-client")

const CommunityJson = require("../../build/CommunityProduct")

/** @typedef {string} EthereumAddress */

/**
 * Deploy a new CommunityProduct contract and create the required joinPartStream
 * @param {Wallet} wallet to do the deployment from, also becomes owner or stream and contract
 * @param {EthereumAddress} operatorAddress community-product-server that should operate the contract
 * @param {EthereumAddress} tokenAddress
 * @param {Number} blockFreezePeriodSeconds
 * @param {Function} log
 */
async function deployCommunity(wallet, operatorAddress, tokenAddress, blockFreezePeriodSeconds, log, streamrWsUrl, streamrHttpUrl) {
    const joinPartStreamName = `Join-Part-${wallet.address.slice(0, 10)}-${Date.now()}`

    log && log(`Creating joinPartStream (name = ${joinPartStreamName})...`)
    const privateKey = wallet.privateKey
    const opts = { auth: { privateKey } }
    if (streamrWsUrl) { opts.url = streamrWsUrl }
    if (streamrHttpUrl) { opts.restUrl = streamrHttpUrl }
    const client = new StreamrClient(opts)
    const stream = await client.getOrCreateStream({
        name: joinPartStreamName,
        public: true,
    })

    log && log(`Deploying root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds}, joinPartStream = ${stream.id})...`)
    const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, stream.id, tokenAddress, blockFreezePeriodSeconds)
    await result.deployed()
    return result
}

module.exports = deployCommunity
