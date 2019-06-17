const { ContractFactory } = require("ethers")
const CommunityJson = require("../../build/CommunityProduct")

module.exports = async function deployContract(wallet, operatorAddress, joinPartStreamName, tokenAddress, blockFreezePeriodSeconds, log) {
    log && log(`Deploying root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds})...`)
    const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, joinPartStreamName, tokenAddress, blockFreezePeriodSeconds)
    await result.deployed()
    return result.address
}
