const Channel = require("../../src/streamrChannel")

const sleep = require("../../src/utils/sleep-promise")

async function start() {
    console.log("Starting server...")
    const channel = new Channel("NIwHuJtMQ9WRXeU5P54f6A6kcv29A4SNe4FDb06SEPyg", "test1")
    await channel.startServer()

    await sleep(200)

    //for (let i = 0; i < 2; i++) {
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
    //}
    channel.close()
}

start()
