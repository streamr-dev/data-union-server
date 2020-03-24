const { ContractFactory } = require("ethers")

const DataUnionContract = require("../../build/DataunionVault")

/** @typedef {string} EthereumAddress */

/**
 * Deploy a CommunityProduct contract with no real joinPartStream, for (unit) test purposes
 * @param {Wallet} wallet to do the deployment from, also becomes owner or stream and contract
 * @param {EthereumAddress} operatorAddress community-product-server that should operate the contract
 * @param {EthereumAddress} tokenAddress
 * @param {Number} blockFreezePeriodSeconds
 * @param {Number} adminFeeFraction
 * @param {Function} log
 */
async function deployTestDataunion(wallet, operatorAddress, tokenAddress, blockFreezePeriodSeconds, adminFeeFraction, log) {
    log && log(`Deploying DUMMY root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds}, no joinPartStream...`)
    const deployer = new ContractFactory(DataUnionContract.abi, DataUnionContract.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, "dummy-stream-id", tokenAddress, blockFreezePeriodSeconds, adminFeeFraction)
    await result.deployed()
    return result
}

module.exports = deployTestDataunion
