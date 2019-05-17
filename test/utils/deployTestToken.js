const { ContractFactory } = require("ethers")

const TokenJson = require("../../build/TestToken")

// TODO: use sendOptions
module.exports = async function deployTestToken(wallet, tokenName, tokenSymbol, sendOptions, log) {
    log && log("Deploying a dummy token contract...")
    const deployer = new ContractFactory(TokenJson.abi, TokenJson.bytecode, wallet)
    const result = await deployer.deploy(
        tokenName || "Test token",
        tokenSymbol || "\ud83e\udd84"
    )
    await result.deployed()
    return result.address
}
