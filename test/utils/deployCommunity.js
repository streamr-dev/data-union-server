const { ContractFactory } = require("ethers")
const CommunityJson = require("../../build/CommunityProduct")

module.exports = async function deployContract(wallet, operatorAddress, joinPartStreamId, tokenAddress, blockFreezePeriodSeconds, log) {
    log && log(`Deploying root chain contract (token @ ${tokenAddress}, blockFreezePeriodSeconds = ${blockFreezePeriodSeconds})...`)
    const deployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
    const result = await deployer.deploy(operatorAddress, joinPartStreamId, tokenAddress, blockFreezePeriodSeconds)
    await result.deployed()
    return result.address
}
