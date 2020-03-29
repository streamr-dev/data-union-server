const { ContractFactory } = require("ethers")

const TokenContract = require("../../build/TestToken")

module.exports = async function deployTestToken(wallet, tokenName, tokenSymbol, log) {
    log && log("Deploying a dummy token contract...")
    const deployer = new ContractFactory(TokenContract.abi, TokenContract.bytecode, wallet)
    const result = await deployer.deploy(
        tokenName || "Test token",
        tokenSymbol || "\ud83e\udd84"
    )
    await result.deployed()
    return result.address
}
