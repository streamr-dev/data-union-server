const { spawn } = require("child_process")
const os = require("os")
const path = require("path")

const log = require("debug")("Streamr::dataunion::test::utils::start-server")

const { untilStreamContains } = require("./await-process-stream")

const {
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,
    ETHEREUM_SERVER,
    OPERATOR_PRIVATE_KEY,
    TOKEN_ADDRESS,
    WEBSERVER_PORT,
    BLOCK_FREEZE_SECONDS,
} = require("../CONFIG")

function onServerClose(code, signal) {
    throw new Error(`start_server.js exited with code ${code}, signal ${signal}`)
}

function onServerError(err) {
    log(`start_server.js ERROR: ${err}`)
    process.exitCode = 1
}

let serverProcess

async function startServer() {
    log("--- Running start_server.js ---")
    serverProcess = spawn(process.execPath, ["scripts/start_server.js"], {
        env: {
            STREAMR_WS_URL,
            STREAMR_HTTP_URL,
            ETHEREUM_SERVER,
            OPERATOR_PRIVATE_KEY,
            TOKEN_ADDRESS,
            STORE_DIR: path.join(os.tmpdir(), `test-server-store-${+new Date()}`),
            WEBSERVER_PORT,
            BLOCK_FREEZE_SECONDS,
            RESET: "yesplease",
            DEBUG: process.env.DEBUG,
            DEBUG_COLORS: "true"
        }
    })
    serverProcess.stdout.on("data", data => { log(`<server stdio> ${String(data).trim()}`) })
    serverProcess.stderr.on("data", data => { log(`<server stderr> ${String(data).trim()}`) })
    serverProcess.on("close", onServerClose)
    serverProcess.on("error", onServerError)

    await untilStreamContains(serverProcess.stdout, "[DONE]")

    return serverProcess
}

function killServerProcess() {
    if (serverProcess) {
        serverProcess.removeListener("close", onServerClose)
        serverProcess.removeListener("error", onServerError)
        serverProcess.kill()
        serverProcess = null
    }
}

module.exports = {
    startServer,
    killServerProcess,
}
