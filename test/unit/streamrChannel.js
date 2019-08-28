
const assert = require("assert")

const Channel = require("../../src/streamrChannel")

const { until } = require("../utils/await-until")
const assertFails = require("../utils/assert-promise-fails")

const privateKey = "0x1234567812345678123456781234567812354678123456781234567812345678"

const urls = {
    ws: process.env.STREAMR_WS_URL,
    http: process.env.STREAMR_HTTP_URL,
}

describe("streamrChannel", () => {
    it("gets messages through", async () => {
        const sendChannel = new Channel(privateKey, "streamrChannel-test2", urls.ws, urls.http)
        await sendChannel.startServer()

        const recvChannel = new Channel(privateKey, "streamrChannel-test2", urls.ws, urls.http)
        await recvChannel.listen()
        let joinMsg = [], partMsg = []
        recvChannel.on("join", msg => { joinMsg = msg })
        recvChannel.on("part", msg => { partMsg = msg })

        await sendChannel.publish("join", [
            "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
            "0x4178babe9e5148c6d5fd431cd72884b07ad855a0",
            "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1",
        ])
        await sendChannel.publish("part", [
            "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
            "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1",
        ])

        await until(() => joinMsg.length > 0 && partMsg.length > 0)
        assert.strictEqual(joinMsg[1], "0x4178babe9e5148c6d5fd431cd72884b07ad855a0")
        assert.strictEqual(partMsg[1], "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1")

        await sendChannel.close()
        await recvChannel.close()
    }).timeout(15000)

    it("can't double-start server", async () => {
        const channel = new Channel(privateKey, "streamrChannel-test1", urls.ws, urls.http)
        await channel.startServer()
        assertFails(channel.startServer(), "Already started as server")
        assertFails(channel.listen(), "Already started as server")
        await channel.close()
    })

    it("can't double-start client", async () => {
        const channel = new Channel(privateKey, "streamrChannel-test1", urls.ws, urls.http)
        await channel.listen()
        assertFails(channel.startServer(), "Already started as client")
        assertFails(channel.listen(), "Already started as client")
        await channel.close()
    }).timeout(5000)

    it("listen() promise resolves after old messages have arrived", async () => {
        const streamName = "streamrChannel-test3-" + Date.now()

        const sendChannel = new Channel(privateKey, streamName, urls.ws, urls.http)
        await sendChannel.startServer()

        const sendQueue = [
            ["join", ["0xdc353aa3d81fc3d67eb49f443df258029b01d8ab"]],
            ["join", ["0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"]],
            ["join", ["0xa6743286b55f36afa5f4e7e35b6a80039c452dbd"]],
        ]
        for (const message of sendQueue) {
            await sendChannel.publish(...message)
        }
        await sendChannel.close()

        const recvQueue = []
        const recvChannel = new Channel(privateKey, streamName, urls.ws, urls.http)
        recvChannel.on("message", (topic, addressList) => {
            recvQueue.push([topic, addressList])
        })
        await recvChannel.listen()
        await recvChannel.close()

        assert.deepStrictEqual(recvQueue, sendQueue)

    }).timeout(10000)
})
