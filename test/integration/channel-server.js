/* eslint-disable no-console */ // this test uses console to communicate with main runner

const Channel = require("../../src/streamrChannel")

const sleep = require("../../src/utils/sleep-promise")

const privateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"  // ganache 0

const { STREAMR_WS_URL, STREAMR_HTTP_URL } = require("./CONFIG")

const streamId = process.env.__JOINPART_STREAM_ID

async function start() {
    console.log("Starting server...")
    const channel = new Channel(streamId, STREAMR_WS_URL, STREAMR_HTTP_URL)
    await channel.startServer(privateKey)
    console.log("Stream ID", channel.stream.id)

    await sleep(200)
    console.log("Sending joins")
    channel.publish("join", [
        "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
        "0x4178babe9e5148c6d5fd431cd72884b07ad855a0",
        "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1",
    ])
    await sleep(300)
    console.log("Sending parts")
    channel.publish("part", [
        "0xdc353aa3d81fc3d67eb49f443df258029b01d8ab",
        "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1",
    ])
    await sleep(300)
    console.log("[OK]")

    channel.close()
}

if (streamId) {
    start()
}
