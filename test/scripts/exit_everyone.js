const { spawn } = require("child_process")
const assert = require("assert")

const {
    Contract,
    getDefaultProvider,
    providers: { JsonRpcProvider },
    utils: { computeAddress, parseEther },
} = require("ethers")

const { throwIfNotContract } = require("../../src/utils/checkArguments")

const TokenContract = require("../../build/ERC20Detailed.json")
const DataUnionContract = require("../../build/DataunionVault.json")

const log = require("debug")("Streamr::dataunion::test::integration::exit-everyone-script")

const { untilStreamContains, untilStreamMatches } = require("../utils/await-process-stream")

const sleep = require("../../src/utils/sleep-promise")

const envDefaults = require("../CONFIG")
envDefaults.STORE_DIR = __dirname + `/exit-everyone-test-store-${+new Date()}`
//envDefaults.WEBSERVER_PORT = 8882

/**
 * Runs a script in scripts directory, immediately returns
 * @param {string} scriptName
 * @param {Object} envOverrides
 * @returns {ChildProcess} the started script process
 */
function startScript(scriptName, envOverrides) {
    log(`--- Running ${scriptName} ---`)
    const env = Object.assign({}, envDefaults, envOverrides)
    const proc = spawn(process.execPath, ["scripts/" + scriptName], { env })
    proc.stdout.on("data", data => { log(`${scriptName} stdout: ${data.toString().trim()}`) })
    proc.stderr.on("data", data => { log(`${scriptName} STDERR: ${data}`) })
    proc.on("close", code => { log(`${scriptName} exited with code ${code}`) })
    proc.on("error", err => { log(`${scriptName} ERROR: ${err}`) })
    proc.scriptName = scriptName
    return proc
}

/**
 * Returns when script says it's done, or exits, or timeouts
 * @param {ChildProcess} scriptProcess to monitor
 * @param {number} timeoutMs after which to throw
 * @returns {String|number} stdout line containing "[DONE]", or exit code if exited
 * @throws if timed out
 */
async function scriptIsDone(scriptProcess, timeoutMs = 30000) {
    return Promise.race([
        untilStreamContains(scriptProcess.stdout, "[DONE]"),
        new Promise(done => {
            scriptProcess.on("close", done)
        }),
        sleep(timeoutMs).then(() => {
            throw new Error(`${scriptProcess.scriptName} timed out after ${timeoutMs}ms`)
        })
    ])
}

/**
 * @typedef {Object} ScriptMatches
 * @property {ChildProcess} scriptProcess
 * @property {Array<RegExpMatchArray>} matches
 */

/**
 * Runs a script and returns matches after string "[DONE]" is observed in output
 * @param {string} scriptName
 * @param {Array<RegExp>} regexMatchList to match the first occurrence from the script output, e.g. [ /sent (.*) tokens to (.*)/ ]
 * @param {Object} envOverrides
 * @returns {ScriptMatches} matches from the given regex, e.g. [ ["...", "300", "0x12354678", index: 15, ...] ]
 */
async function runScriptAndMatchOutput(scriptName, regexMatchList, envOverrides) {
    const scriptProcess = startScript(scriptName, envOverrides)
    const matchPromises = regexMatchList.map(regex => untilStreamMatches(scriptProcess.stdout, regex))
    await scriptIsDone(scriptProcess)

    // clean up unfinished promises with Promise.race
    // if null value were empty array, [0] etc. would return undefined instead of throwing
    const matches =
        await Promise.all(
            matchPromises.map(p =>
                Promise.race([p, undefined])
            )
        )

    return {
        scriptProcess,
        matches
    }
}

// private keys corresponding to "testrpc" mnemonic
const privateKeys = [
    "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", // operator, token owner
    "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // admin
    "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae",
    "0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9",
    "0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297",
    "0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728",
    "0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14",
    "0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7",
    "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285",
    "0x2c326a4c139eced39709b235fffa1fde7c252f3f7b505103f7b251586c35d543",
    "0x1000000000000000000000000000000000000000000000000000000000000"
]

function getDummyPrivateKey(i) {
    if (typeof i !== "number" || i < 0 || i > 999) {
        throw new Error("Parameter must be a number 0...999")
    }
    const padded = i.toString().padStart(3, "0")
    return "0x1000000000000000000000000000000000000000000000000000000000000" + padded
}

describe("Exit everyone script", () => {
    let processesToCleanUp = []
    afterEach(async () => {
        for (const p of processesToCleanUp) {
            p.kill()
            await sleep(100)
        }
    })

    async function runScript(scriptName, envOverrides) {
        const serverProcess = await startScript(scriptName, envOverrides)
        processesToCleanUp.push(serverProcess)
        const exitCode = await scriptIsDone(serverProcess)
        if (typeof exitCode === "number" && exitCode !== 0) {
            throw new Error(`${scriptName} exited with error, code ${exitCode}`)
        }
    }

    const {
        ETHEREUM_SERVER,            // explicitly specify server address
        ETHEREUM_NETWORK,           // use ethers.js default servers
    } = envDefaults
    const provider = ETHEREUM_SERVER ? new JsonRpcProvider(ETHEREUM_SERVER) : getDefaultProvider(ETHEREUM_NETWORK)

    it("successfully exits everyone using one address", async function() {
        this.timeout(60000)

        await runScript("start_server.js", 600000)

        const deploy = await runScriptAndMatchOutput("deploy.js", [/contract at (.*)/])
        processesToCleanUp.push(deploy.scriptProcess)
        const DATAUNION_ADDRESS = deploy.matches[0][1]

        await runScript("join_dataunion.js", {
            ETHEREUM_PRIVATE_KEY: privateKeys[1],
            DATAUNION_ADDRESS
        })

        await runScript("join_dataunion.js", {
            ETHEREUM_PRIVATE_KEY: privateKeys[2],
            DATAUNION_ADDRESS
        })

        await runScript("send_tokens.js", {
            DATA_TOKEN_AMOUNT: "1",
            SLEEP_MS: "0",
            ETHEREUM_PRIVATE_KEY: privateKeys[3],
            DATAUNION_ADDRESS
        })

        const dataunion = new Contract(DATAUNION_ADDRESS, DataUnionContract.abi, provider)
        const tokenAddress = await throwIfNotContract(provider, await dataunion.token(), `DataunionVault(${DATAUNION_ADDRESS}).token()`)
        const token = new Contract(tokenAddress, TokenContract.abi, provider)
        const address = computeAddress(privateKeys[1])
        const balanceBefore = await token.balanceOf(address)

        await runScript("exit_everyone.js", {
            ETHEREUM_PRIVATE_KEY: privateKeys[4],
            SLEEP_MS: "0",
            DATAUNION_ADDRESS
        })

        const balanceAfter = await token.balanceOf(address)
        const difference = balanceAfter.sub(balanceBefore)
        assert.equal(difference.toString(), parseEther("0.5"))
    })

    it("successfully exits everyone using many addresses in parallel", async function() {
        this.timeout(60000)

        await runScript("start_server.js", 600000)

        const deploy = await runScriptAndMatchOutput("deploy.js", [/contract at (.*)/])
        processesToCleanUp.push(deploy.scriptProcess)
        const DATAUNION_ADDRESS = deploy.matches[0][1]

        const keys = []
        const addresses = []
        for (let i = 1; i <= 10; i++) {
            const ETHEREUM_PRIVATE_KEY = getDummyPrivateKey(i)
            keys.push(ETHEREUM_PRIVATE_KEY)
            addresses.push(computeAddress(ETHEREUM_PRIVATE_KEY))
            await runScript("join_dataunion.js", {
                ETHEREUM_PRIVATE_KEY,
                DATAUNION_ADDRESS
            })
        }

        await runScript("send_tokens.js", {
            DATA_TOKEN_AMOUNT: "1",
            SLEEP_MS: "0",
            ETHEREUM_PRIVATE_KEY: privateKeys[3],
            DATAUNION_ADDRESS
        })

        const dataunion = new Contract(DATAUNION_ADDRESS, DataUnionContract.abi, provider)
        const tokenAddress = await throwIfNotContract(provider, await dataunion.token(), `DataunionVault(${DATAUNION_ADDRESS}).token()`)
        const token = new Contract(tokenAddress, TokenContract.abi, provider)
        const balancesBefore = Promise.all(addresses.map(a => token.balanceOf(a)))

        await runScript("exit_everyone.js", {
            ETHEREUM_PRIVATE_KEYS: privateKeys.slice(4, 7).toString(),  // comma-separated list
            SLEEP_MS: "0",
            DATAUNION_ADDRESS
        })

        const balancesAfter = Promise.all(addresses.map(a => token.balanceOf(a)))
        for (let i = 0; i < addresses.length; i++) {
            const difference = balancesAfter[i].sub(balancesBefore[i])
            assert.equal(difference.toString(), parseEther("0.1"))
        }
    })
})
