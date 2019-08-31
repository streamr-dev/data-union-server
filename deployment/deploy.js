const etherlime = require("etherlime")
const CommunityProduct = require("../build/CommunityProduct.json")


const deploy = async (/*network, secret*/) => {
    const deployer = new etherlime.EtherlimeGanacheDeployer()
    const result = await deployer.deploy(CommunityProduct)
    console.log("Result " + result)
}

module.exports = {
    deploy
}