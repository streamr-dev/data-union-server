// testing how ethers.js does getPastEvents
//   and how to make it work reliably with Ganache

require("dotenv/config")

const {
    Contract,
    Wallet,
    providers: { Web3Provider }, //, JsonRpcProvider },
} = require("ethers")

const deployTestToken = require("../test/utils/deployTestToken")
const sleep = require("../src/utils/sleep-promise")

//const startGanache = require("monoplasma/src/utils/startGanache")
const ganacheLib = require("ganache-core")

const ganacheBlockIntervalSeconds = 0
const fakeTxCount = 20

const ERC20Mintable = require("../build/ERC20Mintable.json")

function error(err) {
    console.error(err.stack)
    process.exit(1)
}

async function start() {
    const ganacheLog = msg => {
        if (msg.match("0x")) {
            console.log(" <Ganache> " + msg)
        }
    }

    // Start Ganache Core (library)
    const keys = [
        "0x1234567812345678123456781234567812345678123456781234567812345678",
        "0x1234567812345678123456781234567812345678123456781234567812345677",
        "0x1234567812345678123456781234567812345678123456781234567812345676",
        "0x1234567812345678123456781234567812345678123456781234567812345675",
    ]
    const provider = new Web3Provider(ganacheLib.provider({
        accounts: keys.map(secretKey => ({ secretKey, balance: "0xffffffffffffffffffffffffff" })),
        logger: { log: ganacheLog },
        blockTime: ganacheBlockIntervalSeconds,
    }))

    const wallets = keys.map(key => new Wallet(key, provider))
    provider.pollingInterval = 500
    const network = await provider.getNetwork()
    console.log(`Deploying test token contract (network id = ${network.chainId})...`)
    const tokenAddress = await deployTestToken(wallets[0])
    const tokens = wallets.map(wallet => new Contract(tokenAddress, ERC20Mintable.abi, wallet))

    const startTime = Date.now()
    const filter = tokens[0].filters.Transfer
    tokens[0].on(filter, (...args) => {
        const event = args.pop()
        console.log(`[${Date.now() - startTime}] Got event at block ${event.blockNumber}`)
    })

    console.log(`Generating ${fakeTxCount} transactions...`)
    const blockNumbers = []
    for (let i = 0; i < fakeTxCount; i++) {
        console.log(`[${Date.now() - startTime}] Sending tx ${i}`)
        const from = i % wallets.length
        const to = (i + 1) % wallets.length
        const tx = await tokens[from].transfer(wallets[to].address, 1000)
        const tr = await tx.wait(1)
        console.log(`[${Date.now() - startTime}] Sent tx ${i}, it went into block ${tr.blockNumber}`)
        blockNumbers.push(tr.blockNumber)
    }

    await sleep(provider.pollingInterval * 3)

    process.exit(0)
}
start().catch(error)
