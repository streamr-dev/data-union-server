const sinon = require("sinon")
const assert = require("assert")

const log = require("debug")("Streamr::CPS::test::unit::watcher")

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
    lastPublishedBlock: {
        blockNumber: 3
    }
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
        watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store)
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

    it("interleaves join messages and Transfer events correctly during playback", async function () {
        this.timeout(10000)
        await community.setAdminFee(parseEther("0.5"))
        await sleep(1000)
        log("Admin fee: " + watcher.plasma.adminFeeFraction)

        log(JSON.stringify(watcher.plasma.getMembers()))

        await token.transfer(community.address, 40) // -> 20/2 = 10 for members, 20 for admin
        await sleep(1000)
        log(JSON.stringify(watcher.plasma.getMembers()))
        const afterTransfer1 = await wallet.provider.getBlock()
        await new Promise(done => {
            watcher.on("join", done)
            joinPartChannel.publish("join", ["0x1234567812345678123456781234567812345678"])
        })

        log(JSON.stringify(watcher.plasma.getMembers()))

        await token.transfer(community.address, 30) // -> 15/3 = 5 for members, 15 for admin
        await sleep(1000)
        log(JSON.stringify(watcher.plasma.getMembers()))
        const afterTransfer2 = await wallet.provider.getBlock()
        await new Promise(done => {
            watcher.on("join", done)
            joinPartChannel.publish("join", ["0x2234567812345678123456781234567812345678"])
        })
        await token.transfer(community.address, 40) // -> 20/4 = 5 for members, 20 for admin

        await sleep(1000)
        log(JSON.stringify(watcher.plasma.getMembers()))
        const expectedBalances = [
            { address: "0x2F428050ea2448ed2e4409bE47e1A50eBac0B2d2", earnings: "70" }, // 50 startBalance + 10 + 5 + 5
            { address: "0xb3428050ea2448ed2e4409be47e1a50ebac0b2d2", earnings: "40" }, // 20 startBalance + 10 + 5 + 5
            { address: "0x1234567812345678123456781234567812345678", earnings: "10" }, // 0 startBalance + 5 + 5
            { address: "0x2234567812345678123456781234567812345678", earnings: "5" }, // 0 startBalance + 5
        ]
        assert.deepStrictEqual(watcher.plasma.getMembers(), expectedBalances)

        joinPartChannel.pastEventsWithTimestamps = [
            [afterTransfer1.timestamp * 1000, "join", ["0x1234567812345678123456781234567812345678"]],
            [afterTransfer2.timestamp * 1000, "join", ["0x2234567812345678123456781234567812345678"]],
        ]
        await startWatcher()

        assert(store.lastSavedState)
        assert.deepStrictEqual(watcher.plasma.getMembers(), expectedBalances)
    })

    it("admin share is calculated correctly", () => {
        // TODO
    })
})
