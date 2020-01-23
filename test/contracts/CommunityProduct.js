/*global accounts assert utils */

const log = require("debug")("CPS::test::contracts::CommunityProduct")

const etherlime = require("etherlime")
const CommunityProduct = require("../../build/CommunityProduct.json")
const TestToken = require("../../build/TestToken.json")
//const assert = require("assert")

describe("CommunityProduct", () => {
    const admin = accounts[3]
    const operator = accounts[2]
    let deployer
    let token
    let community
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
        community = await deployer.deploy(CommunityProduct, false, operatorAddress, joinPartStreamId, syncStreamId, tokenAddress, blockFreezePeriodSeconds)
    })

    it("should emit event upon creation", async () => {
        const expectedEvent = "OperatorChanged"
        const transactionReceipt = eth.getTransactionReceipt(community.deployTransaction)
        let isEmitted = utils.hasEvent(transactionReceipt, community.contract, expectedEvent)
        assert(isEmitted, "Event OperatorChanged was not emitted")
    })

    it("should have valid private key", async () => {
        assert.strictEqual(deployer.signer.privateKey, admin.secretKey)
    })

    it("should be valid address", async () => {
        assert.isAddress(community.contractAddress, "The contract was not deployed")
    })
})