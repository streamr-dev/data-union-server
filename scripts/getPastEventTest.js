require("dotenv/config")
//
// testing how ethers.js does getPastEvents
//   and how to make it work reliably with Ganache

const { Contract, Wallet, utils, providers: { JsonRpcProvider } } = require("ethers")

const deployTestToken = require("../test/utils/deployTestToken")
const sleep = require("../src/utils/sleep-promise")

const ganacheBlockIntervalSeconds = 0
const fakeTxCount = 20

const ERC20Mintable = require("../build/ERC20Mintable.json")

function error(err) {
    console.error(err.stack)
    process.exit(1)
}

async function start() {
    const logger = {
        log: msg => {
            if (msg.match("0x")) {
                console.log(" <Ganache> " + msg)
            }
        }
    }
    ganache = await startGanache(8263, ganacheLog, ganacheLog, ganacheBlockIntervalSeconds)
    const secretKey = "0x1234567812345678123456781234567812345678123456781234567812345678"
    const provider = new Web3Provider(ganache.provider({
        accounts: [{ secretKey, balance: "0xffffffffffffffffffffffffff" }],
        logger,
    }))
    const wallet = new Wallet(secretKey, provider)
    await provider.getNetwork()     // wait until ganache is up and ethers.js ready

    const provider = new JsonRpcProvider(ganache.httpUrl)
    provider.pollingInterval = 500
    const wallets = ganache.privateKeys.map(key => new Wallet(key, provider))
    const network = await provider.getNetwork()
    console.log(`Deploying test token contract (network id = ${network.chainId})...`)
    const tokenAddress = await deployTestToken(wallets[0])
    const tokens = wallets.map(wallet => new Contract(tokenAddress, ERC20Mintable.abi, wallet))

    console.log(`Generating ${fakeTxCount} transactions...`)
    const blockNumbers = []
    for (let i = 0; i < fakeTxCount; i++) {
        const from = i % wallets.length
        const to = (i + 1) % wallets.length
        const tx = await tokens[from].transfer(wallets[to].address, 1000)
        const tr = await tx.wait(1)
        console.log(`Sent, tx went into block ${tr.blockNumber}`)
        blockNumbers.push(tr.blockNumber)
    }

    const startBlock = blockNumbers[fakeTxCount / 2]
    provider.on({ topics: [utils.id("Transfer(address,address,uint256)")] }, async event => {
        const t = Date.now() - startTime
        console.log(`Got event at block ${event.blockNumber} after ${t} ms`)
    })
    console.log(`Fetching the past events starting from block ${startBlock} using resetEventsBlock`)
    const startTime = Date.now()
    provider.resetEventsBlock(startBlock)

    await sleep(provider.pollingInterval + 500)

    console.log(`Fetching the transfers to ${wallets[1].address} using getLogs`)

    const filter = tokens[0].filters.Transfer
    filter.fromBlock = 0
    const rawLogs = await provider.getLogs(filter)
    const logs = rawLogs.map(event => {
        event.event = "Transfer"
        const parsed = tokens[0].interface.parseLog(event)
        event.args = parsed ? parsed.values : null
        return event
    })
    console.log(logs.map(JSON.stringify).join("\n"))

    ganache.shutdown()
    process.exit(0)
}
start().catch(error)
