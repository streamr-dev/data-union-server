const sinon = require("sinon")
const assert = require("assert")

const {
    Wallet,
    ContractFactory,
    utils: { parseEther },
    providers: { Web3Provider }
} = require("ethers")
const ganache = require("ganache-core")
//const { Wallet, ContractFactory, providers: { JsonRpcProvider } } = require("ethers")
//const startGanache = require("monoplasma/src/utils/startGanache")

const CommunityJson = require("../../build/CommunityProduct")
const TokenJson = require("../../build/TestToken")

const sleep = require("../../src/utils/sleep-promise")

const MockStreamrChannel = require("../utils/mockStreamrChannel")
const mockStore = require("monoplasma/test/utils/mockStore")

const log = console.log  // () => {}
const error = e => {
    console.error(e.stack)
    process.exit(1)
}

const members = [
    { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: "50" },
    { address: "0xb3428050ea2448ed2e4409be47e1a50ebac0b2d2", earnings: "20" },
]
const initialBlock = {
    blockNumber: 3,
    members,
    totalEarnings: 70,
    timestamp: Date.now(),
}
const startState = {
    lastBlockNumber: 5,
    lastPublishedBlock: 3,
}

const MonoplasmaWatcher = require("../../src/watcher")
describe("MonoplasmaWatcher", () => {
    let watcher
    let wallet
    let token
    let community
    let joinPartChannel
    let store
    before(async function () {
        this.timeout(0)

        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: { log },
            //blockTime: 1,
        }))
        /*
        const ganache = await startGanache(8678, () => {}, null, 1)
        const provider = new JsonRpcProvider(ganache.httpUrl)
        const secretKey = ganache.privateKeys[0]
        */

        provider.pollingInterval = 500
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        // "start from" block 10
        for (let i = 0; i < 10; i++) {
            await provider.send("evm_mine")
        }

        joinPartChannel = new MockStreamrChannel(secretKey, "dummy-stream-for-watcher-test")
        store = mockStore(startState, initialBlock, log)

        log("Deploying test token and Community contract...")
        const tokenDeployer = new ContractFactory(TokenJson.abi, TokenJson.bytecode, wallet)
        token = await tokenDeployer.deploy("Test token", "TEST")
        await token.deployed()
    })

    beforeEach(async function () {
        const communityDeployer = new ContractFactory(CommunityJson.abi, CommunityJson.bytecode, wallet)
        community = await communityDeployer.deploy(wallet.address, "dummy-stream-id", token.address, 1000, 0)
        await community.deployed()
        await startWatcher()
    })

    async function startWatcher() {
        log("Starting MonoplasmaWatcher...")
        watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store, log, error)
        await watcher.start({
            tokenAddress: token.address,
            adminAddress: wallet.address,
            operatorAddress: wallet.address,
            contractAddress: community.address,
        })
    }

    it("catches Transfer events", async () => {
        const cb = sinon.fake()
        watcher.on("tokensReceived", cb)
        const tx = await token.transfer(community.address, 1)
        const tr = await tx.wait(1)
        await sleep(wallet.provider.pollingInterval * 2 + 100)
        assert(tr.logs.length > 0)
        assert.strictEqual(cb.callCount, 1)
    })

    it("catches BlockCreate events", async () => {
        const cb = sinon.fake()
        watcher.on("blockCreated", cb)
        const tx = await community.commit(1, "0x1234567812345678123456781234567812345678123456781234567812345678", "")
        const tr = await tx.wait(1)
        await sleep(wallet.provider.pollingInterval * 2 + 100)
        assert(tr.logs.length > 0)
        assert.strictEqual(cb.callCount, 1)
    })

    it("catches join messages", async () => {
        const cb = sinon.fake()
        watcher.on("join", cb)
        joinPartChannel.publish("join", ["0x1234567812345678123456781234567812345678"])
        await sleep(1000)
        assert(cb.calledOnceWithExactly(["0x1234567812345678123456781234567812345678"]))
    })

    it("splits tokens between members and updates the state correctly during playback", async function () {
        await community.setAdminFee(parseEther("0.5"))
        await token.transfer(community.address, 40)
        await token.transfer(community.address, 40)

        await sleep(1000)
        await startWatcher()

        assert(store.lastSavedState)
        const newBalances = [
            { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: "70" }, // 50 startBalance + 10 + 10 (40 -> 20/2, 20 for admin)
            { address: "0xb3428050ea2448ed2e4409be47e1a50ebac0b2d2", earnings: "40" }, // 20 startBalance + 10 + 10
        ]
        assert.deepStrictEqual(watcher.plasma.getMembers(), newBalances)
    })
})
