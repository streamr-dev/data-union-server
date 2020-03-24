const assert = require("assert")
const sleep = require("../../src/utils/sleep-promise")
const sinon = require("sinon")
const os = require("os")
const path = require("path")
const { Wallet, providers: { Web3Provider } } = require("ethers")

const log = console.log // require("debug")("Streamr::CPS::test::unit::server")

const ganache = require("ganache-core")

const MockStreamrChannel = require("../utils/mockStreamrChannel")
const deployTestToken = require("../utils/deployTestToken")
const deployTestDataunion = require("../utils/deployTestDataunion")
const pollingIntervalSeconds = 0.1

const { until } = require("../utils/await-until")

const CommunityProductServer = require("../../src/server")

describe("CommunityProductServer", function () {
    this.timeout(10000)
    let tokenAddress
    let wallet
    let server

    beforeEach(async () => {
        const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
        const provider = new Web3Provider(ganache.provider({
            accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
            logger: console,
        }))
        provider.pollingInterval = pollingIntervalSeconds * 100
        wallet = new Wallet(secretKey, provider)
        await provider.getNetwork()     // wait until ganache is up and ethers.js ready

        log("Deploying test token...")
        tokenAddress = await deployTestToken(wallet)
    })

    let storeDir
    let config

    beforeEach(() => {
        storeDir = path.join(os.tmpdir(), `server-test-${+new Date()}`)
        config = {
            tokenAddress,
            operatorAddress: wallet.address,
        }
        server = new CommunityProductServer(wallet, storeDir, config, log, log)
        server.getChannelFor = () => new MockStreamrChannel("dummy-stream-id")
    })

    afterEach(async () => {
        if (server) {
            await server.stop()
        }
    })

    describe("start/stop behaviour", () => {
        it("errors if starting after stopping", async function () {
            await server.start()
            await server.stop()
            await assert.rejects(() => server.start())
        })
    })

    it("notices creation of a new CommunityProduct and starts Operator", async function () {
        sinon.spy(server, "onOperatorChangedEventAt")
        sinon.spy(server, "startOperating")
        await server.start()
        const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        await until(() => server.onOperatorChangedEventAt.calledOnce)

        assert.strictEqual(contract.address, server.onOperatorChangedEventAt.getCall(0).args[0])

        assert(server.startOperating.calledOnce)
        assert.strictEqual(contract.address, server.startOperating.getCall(0).args[0])

        const clist = Object.keys(server.communities)
        assert.strictEqual(1, clist.length)
        assert(server.communities[contract.address])
        await server.stop()
    })

    it("stops operators when server is stopped", async function () {
        await server.start()
        const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        await server.communityIsRunning(contract.address)

        const { communities } = server
        assert(Object.keys(communities), "has at least 1 community")

        await server.stop()

        assert.equal(Object.keys(server.communities).length, 0, "server.communities is empty after stop")
        Object.values(communities).forEach((community) => {
            assert.ok(community.operator.watcher.channel.isClosed())
        })
    })

    describe("ignores communities not assigned to it", function () {
        it("ignores if operator changed before startup", async () => {
            const onError = sinon.spy(server, "error")

            const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
            log(`Deployed contract at ${contract.address}`)

            const contract2 = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
            log(`Deployed contract at ${contract2.address}`)

            // should ignore this contract
            await contract2.setOperator("0x0000000000000000000000000000000000000001")

            // NOTE start AFTER operator is changed
            await server.start()
            await server.communityIsRunning(contract.address)
            //await server.communityIsRunning(contract2.address)    // TODO: should NOT be running, should never be started!

            assert.strictEqual(onError.callCount, 0, "should not have called error handler")
            assert(server.communities[contract.address], "contract1 should be handled")
            assert(!server.communities[contract2.address], "contract2 should be ignored")
            await server.stop()
            assert.strictEqual(onError.callCount, 0, "should not have called error handler")
        })

        it("ignores if operator changed after startup", async () => {
            const onError = sinon.spy(server, "error")
            await server.start()

            const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
            log(`Deployed contract at ${contract.address}`)

            const contract2 = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
            log(`Deployed contract at ${contract2.address}`)

            await server.communityIsRunning(contract.address)
            await server.communityIsRunning(contract2.address)

            assert(server.communities[contract.address], "contract1 should be handled")
            assert(server.communities[contract2.address], "contract2 should be handled")

            // should ignore this contract
            sinon.spy(server, "onOperatorChangedEventAt")
            await contract2.setOperator("0x0000000000000000000000000000000000000001")
            await until(() => server.onOperatorChangedEventAt.calledOnce)
            await server.onOperatorChangedEventAt.returnValues[0]   // wait until handler returns

            assert.strictEqual(onError.callCount, 0, "should not have called error handler")
            assert(server.communities[contract.address], "contract1 should be handled")
            // contract should no longer be handled
            assert(!server.communities[contract2.address], "contract2 should be ignored")
            await server.stop()
            assert.strictEqual(onError.callCount, 0, "should not have called error handler")
        })

        it("ignores if server version doesn't match contract version", async () => {
            // TODO
        })
    })

    it("resumes operating communities it's operated before (e.g. a crash)", async function () {
        const onError = sinon.spy(server, "error")
        await server.start()

        const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await server.communityIsRunning(contract.address)
        await server.communityIsRunning(contract2.address)

        // should ignore this contract
        await contract2.setOperator("0x0000000000000000000000000000000000000001")

        await server.stop()

        await sleep(pollingIntervalSeconds * 1000)

        assert.strictEqual(onError.callCount, 0, "should not have called error handler")

        // create a second server
        const server2 = new CommunityProductServer(wallet, storeDir, config, log, log)
        server2.getChannelFor = () => new MockStreamrChannel("dummy-stream-id")
        const onError2 = sinon.spy(server2, "error")
        await server2.start()

        assert(server2.communities[contract.address], "contract1 should be handled")
        assert(!server2.communities[contract2.address], "contract2 should be ignored")
        assert.strictEqual(onError2.callCount, 0, "should not have called error handler")
        await server2.stop()
    })

    it("will not fail to start if there is an error playing back a community", async function () {
        const onError = sinon.spy(server, "error")

        await server.start()

        const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await server.communityIsRunning(contract.address)
        await server.communityIsRunning(contract2.address)
        log("Communities running")

        await server.stop()
        await sleep(pollingIntervalSeconds * 1000)
        assert.strictEqual(onError.callCount, 0, "should not have called error handler")

        // create a second server
        //
        const server2 = new CommunityProductServer(wallet, storeDir, config, log, log)
        sinon.stub(server2, "getChannelFor")
            .callsFake(() => new MockStreamrChannel("dummy-stream-id"))
            // force one community startup to fail when getting channel
            .withArgs(contract.address).callsFake(async function (add) {
                throw new Error("expected fail " + add)
            })

        const onError2 = sinon.spy(server2, "error")
        await assert.doesNotReject(() => server2.start())
        await server2.stop()
        assert.strictEqual(onError2.callCount, 1, "should have called error handler once")
    })

    it("will fail to start if there is an error playing back all communities", async function () {
        const onError = sinon.spy(server, "error")
        await server.start()

        const contract = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract.address}`)

        const contract2 = await deployTestDataunion(wallet, wallet.address, tokenAddress, 1000, 0)
        log(`Deployed contract at ${contract2.address}`)

        await server.stop()
        await sleep(pollingIntervalSeconds * 1000)
        assert.strictEqual(onError.callCount, 0, "should not have called error handler")
        const server2 = new CommunityProductServer(wallet, storeDir, config, log, log)
        const onError2 = sinon.spy(server2, "error")
        sinon.stub(server2, "getChannelFor").callsFake(async function () {
            throw new Error("expected fail")
        })
        await assert.rejects(() => server2.start())
        assert.strictEqual(onError2.callCount, 2, "should have called error handler twice")
    })
})
