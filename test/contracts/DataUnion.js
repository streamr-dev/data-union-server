/*global accounts assert utils */

const log = require("debug")("Streamr::dataunion::test::contracts::DataunionVault")

const etherlime = require("etherlime")
const DataUnion = require("../../build/contracts/DataunionVault")
const TestToken = require("../../build/contracts/TestToken")
//const assert = require("assert")

describe("DataunionVault", () => {
    const admin = accounts[3]
    const operator = accounts[2]
    let deployer
    let token
    let dataunion
    let eth

    // constructor(address operator, string joinPartStreamId, string syncStreamId, address tokenAddress, uint blockFreezePeriodSeconds)
    before(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(admin.secretKey)
        eth = deployer.provider
        token = await deployer.deploy(TestToken, false, "TestToken", "TEST")
        const joinPartStreamId = "joinpart"
        const syncStreamId = "sync"
        const tokenAddress = token.contract.address
        const blockFreezePeriodSeconds = 5
        const operatorAddress = operator.signer.signingKey.address
        log("Deploy arguments:", operatorAddress, joinPartStreamId, syncStreamId, tokenAddress, blockFreezePeriodSeconds)
        dataunion = await deployer.deploy(DataUnion, false, operatorAddress, joinPartStreamId, syncStreamId, tokenAddress, blockFreezePeriodSeconds)
    })

    it("should emit event upon creation", async () => {
        const expectedEvent = "OperatorChanged"
        const transactionReceipt = eth.getTransactionReceipt(dataunion.deployTransaction)
        let isEmitted = utils.hasEvent(transactionReceipt, dataunion.contract, expectedEvent)
        assert(isEmitted, "Event OperatorChanged was not emitted")
    })

    it("should have valid private key", async () => {
        assert.strictEqual(deployer.signer.privateKey, admin.secretKey)
    })

    it("should be valid address", async () => {
        assert.isAddress(dataunion.contractAddress, "The contract was not deployed")
    })
})
