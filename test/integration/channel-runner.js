const path = require("path")
const { spawn } = require("child_process")

const { untilStreamContains } = require("../utils/await-until")
const sleep = require("../../src/utils/sleep-promise")

const helperFile = path.normalize(path.join(__dirname, "channel"))

describe("Channel", () => {
    // TODO: fix it
    it.skip("gets messages through", async function () {
        const client0 = spawn("node", [`${helperFile}-client.js`])
        await sleep(10)
        const client1 = spawn("node", [`${helperFile}-client.js`])
        await sleep(10)
        const server = spawn("node", [`${helperFile}-server.js`])

        client0.stdout.on("data", buf => { console.log("client 0> " + buf) })
        client1.stdout.on("data", buf => { console.log("client 1> " + buf) })
        server.stdout.on("data", buf => { console.log("server> " + buf) })

        await Promise.all([
            untilStreamContains(client0.stdout, "[OK]"),
            untilStreamContains(client1.stdout, "[OK]"),
            untilStreamContains(server.stdout, "[OK]"),
        ])

        server.kill()
        client1.kill()
        client0.kill()
    }).timeout(10000)
})
