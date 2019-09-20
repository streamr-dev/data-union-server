const path = require("path")
const { spawn } = require("child_process")

const { streamrWs, streamrHttp } = require("./CONFIG")

const { untilStreamContains } = require("../utils/await-until")
const sleep = require("../../src/utils/sleep-promise")
const Channel = require("../../src/streamrChannel")

const helperFile = path.normalize(path.join(__dirname, "channel"))

const privateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"  // ganache 0

describe("Channel", () => {
    let streamId
    before(async function () {
        this.timeout(5000)
        const joinPartChannel = new Channel(privateKey, null, streamrWs, streamrHttp)
        await joinPartChannel.startServer()
        streamId = joinPartChannel.stream.id
        joinPartChannel.close()
    })

    it("gets messages through", async function () {
        this.timeout(20000)
        const startTime = Date.now()
        const time = () => "[" + (Date.now() - startTime).toString().padStart(5, " ") + "ms]"

        console.log("Stream ID", streamId, "\n")

        const opts = {
            env: Object.assign({
                __JOINPART_STREAM_ID: streamId
            }, process.env)
        }
        const client0 = spawn("node", [`${helperFile}-client.js`], opts)
        client0.stdout.on("data", buf => { console.log(time() + " client 0> " + buf) })

        await sleep(100)
        const client1 = spawn("node", [`${helperFile}-client.js`], opts)
        client1.stdout.on("data", buf => { console.log(time() + " client 1> " + buf) })

        await sleep(3000)
        const server = spawn("node", [`${helperFile}-server.js`], opts)
        server.stdout.on("data", buf => { console.log(time() + " server> " + buf) })

        await Promise.all([
            untilStreamContains(client0.stdout, "[OK]"),
            untilStreamContains(client1.stdout, "[OK]"),
            untilStreamContains(server.stdout, "[OK]"),
        ])

        server.kill()
        client1.kill()
        client0.kill()
    })
})
