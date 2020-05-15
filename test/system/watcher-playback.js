const { spawn } = require("child_process")
const os = require("os")
const path = require("path")
const fetch = require("node-fetch")
const log = require("debug")("Streamr::dataunion::test::system::http-api")

const {
    Contract,
    utils: { parseEther, formatEther, computeAddress },
    Wallet,
    providers: { JsonRpcProvider }
} = require("ethers")

const StreamrChannel = require("../../src/streamrChannel")
const FileStore = require("../../src/fileStore")
const deployContract = require("../../src/utils/deployContract")

const { startServer, killServerProcess } = require("../utils/run-start-server-script")
const sleep = require("../../src/utils/sleep-promise")
const assertEqual = require("../utils/assertEqual")

const ERC20Mintable = require("../../build/ERC20Mintable.json")

const tmpDir = path.join(os.tmpdir(), `fileStore-test-${+new Date()}`)
const STORE_DIR = `${tmpDir}/serverStore`

const BLOCK_FREEZE_SECONDS = 1
const ADMIN_FEE = 0.2

const {
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
    STREAMR_NODE_ADDRESS,
    ETHEREUM_SERVER,
    OPERATOR_PRIVATE_KEY,
    TOKEN_ADDRESS,
    WEBSERVER_PORT,
    GAS_PRICE_GWEI,
} = require("../CONFIG")

const MonoplasmaWatcher = require("../../src/watcher")
describe("MonoplasmaWatcher", () => {

    before(() => {
        log(`Creating store directory ${STORE_DIR}`)
        spawn("mkdir", ["-p", STORE_DIR])
    })

    afterEach(killServerProcess)

    it("Correctly replays a 1000000 long joinPartStream history", async () => {
        await startServer()
        const provider = new JsonRpcProvider(ETHEREUM_SERVER)
        const privateKey = "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb"

        const operator = new Wallet(OPERATOR_PRIVATE_KEY, provider)
        const admin = new Wallet(privateKey, provider)
        const token = new Contract(TOKEN_ADDRESS, ERC20Mintable.abi, operator)
        await token.mint(operator.address, parseEther("100000000000"))

        // create data union
        const contract = await deployContract(
            admin,
            operator.address,
            token.address,
            STREAMR_NODE_ADDRESS,
            BLOCK_FREEZE_SECONDS,
            ADMIN_FEE,
            STREAMR_WS_URL,
            STREAMR_HTTP_URL,
            GAS_PRICE_GWEI,
        )

        // push 10 x 100000 join messages, add revenue in the middle
        const batchCount = 2
        const batchSize = 10
        const streamId = await contract.joinPartStream()
        const writeChannel = new StreamrChannel(streamId, STREAMR_WS_URL, STREAMR_HTTP_URL)
        await writeChannel.startServer(privateKey)
        let oldRevenue = 0
        for (let b = 0, j = 0; b < batchCount; b++) {
            for (let i = 0; i < batchSize; i++, j++) {
                const key = "0x1" + j.toString().padStart(63, "0")
                const address = computeAddress(key)
                writeChannel.publish("join", address)
            }

            // operator has token balance already, so this works
            const tokenBatchSize = j.toString()
            log(`Sending ${tokenBatchSize} tokens...`)
            const transferTx = await token.transfer(contract.address, parseEther(tokenBatchSize))
            await transferTx.wait(2)

            // wait for revenue to arrive
            let revenue
            let timeout = 100
            do {
                await sleep(timeout *= 2)
                const stats = await fetch(`http://localhost:${WEBSERVER_PORT}/dataunions/${contract.address}/stats`).then(resp => resp.json())
                revenue = stats.totalEarnings
                if (!revenue) { throw new Error(`Bad stats response: ${JSON.stringify(stats)}`) }
                log(`   Total revenue: ${formatEther(revenue)}`)
            } while (revenue == oldRevenue)
            oldRevenue = revenue
        }

        // start watcher
        const readChannel = new StreamrChannel(streamId, STREAMR_WS_URL, STREAMR_HTTP_URL)
        const watcherStoreDir = `${tmpDir}/serverStore`
        log(`Storing data union ${contract.address} data at ${watcherStoreDir}`)
        const watcherStore = new FileStore(watcherStoreDir)
        const watcher = new MonoplasmaWatcher(provider, readChannel, watcherStore)
        await watcher.start({
            tokenAddress: token.address,
            adminAddress: admin.address,
            operatorAddress: operator.address,
            contractAddress: contract.address,
        })

        // +1 for admin
        assertEqual(watcher.plasma.members.length, 1 + batchSize * batchCount, "Wrong joined member count")

        // check balances are correct
        const earnings = {}
        watcher.plasma.members.forEach(m => {
            earnings[m.address] = m.earnings
            console.log(JSON.stringify(m))
        })
        console.log("Earnings ", JSON.stringify(earnings))
        for (let b = 0, j = 0; b < batchCount; b++) {
            for (let i = 0; i < batchSize; i++, j++) { // TODO
                const key = "0x1" + j.toString().padStart(63, "0")
                const address = computeAddress(key)
                assertEqual(earnings[address], formatEther(batchSize - b), "Wrong earnings")
            }
        }
    })
})