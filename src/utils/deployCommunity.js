const { ContractFactory } = require("ethers")
const StreamrClient = require("streamr-client")
const fetch = require("node-fetch")

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

    // grant permission for streamrNode to write into joinPartStream
    // TODO: add feature to streamr-client
    const res1 = await fetch(`${streamrHttpUrl}/api/v1/node`).then(resp => resp.json())
    const streamrNodeAddress = res1.ethereumAddress
    const res2 = await fetch(`${streamrHttpUrl}/api/v1/streams/${stream.id}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: stream.id,
            user: streamrNodeAddress,
            operation: "write",
        }),
    }).then(resp => resp.json())
    log && log("Response from write permission add", JSON.stringify(res2))

    log && log(`Deploying root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds}, joinPartStream = ${stream.id})...`)
    const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, stream.id, tokenAddress, blockFreezePeriodSeconds)
    await result.deployed()
    return result
}

module.exports = deployCommunity
