const assert = require("assert")

const log = require("debug")("Streamr::dataunion::test::unit::watcher")

const {
    Wallet,
    ContractFactory,
    utils: { parseEther },
    providers: { Web3Provider }
} = require("ethers")
const ganache = require("ganache-core")

const DataUnionContract = require("../../build/DataunionVault")
const TokenContract = require("../../build/TestToken")

const MockStreamrChannel = require("../utils/mockStreamrChannel")
const mockStore = require("../utils/mockStore")
const revenue = parseEther("1")
const members = [
    { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: revenue.div(3).toString() },
    { address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", earnings: revenue.div(3).toString() },
    { address: "0xb3428050eA2448eD2E4409bE47E1a50EBac0B2d2", earnings: revenue.div(3).toString() },
]

const initialBlock = {
    blockNumber: 3,
    members,
    totalEarnings: revenue.toString(),
    timestamp: Date.now(),
}

const startState = {
    lastBlockNumber: 5,
    lastPublishedBlock: {
        blockNumber: 3
    }
}

const MonoplasmaWatcher = require("../../src/watcher")
describe("MonoplasmaWatcher", () => {
    let watcher
    let wallet
    let token
    let dataUnion
    let joinPartChannel
    let store
    before(async function () {
        //this.timeout(0)

        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
            //blockTime: 1,
        }))

        provider.pollingInterval = 500
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        // "start from" block 10
        for (let i = 0; i < 10; i++) {
            await provider.send("evm_mine")
        }

        joinPartChannel = new MockStreamrChannel("dummy-stream-for-watcher-test")
        store = mockStore(startState, initialBlock, log)

        log("Deploying test token and dataUnion contract...")
        const tokenDeployer = new ContractFactory(TokenContract.abi, TokenContract.bytecode, wallet)
        token = await tokenDeployer.deploy("Test token", "TEST")
        await token.deployed()
    })

    beforeEach(async function () {
        const dataUnionDeployer = new ContractFactory(DataUnionContract.abi, DataUnionContract.bytecode, wallet)
        dataUnion = await dataUnionDeployer.deploy(wallet.address, "dummy-stream-id", token.address, 1000, 0)
        await dataUnion.deployed()
        await startWatcher()
    })

    async function startWatcher() {
        log("Starting MonoplasmaWatcher...")
        watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store)
        await watcher.start({
            tokenAddress: token.address,
            adminAddress: wallet.address,
            operatorAddress: wallet.address,
            contractAddress: dataUnion.address,
        })
    }

    it("maintains total revenue", async () => {
        await dataUnion.setAdminFee(0)
        await startWatcher()
        assert.equal(watcher.plasma.getTotalRevenue(), revenue.toString())
    })
})
