const { utils } = require("ethers")

module.exports = class MockStreamrChannel {
    constructor(privateKey, joinPartStreamId/*, streamrWsUrl, streamrHttpUrl*/) {
        this.stream = {
            id: joinPartStreamId,
            name: "Join-Part-Stream-Mock",
        }
        this.ethereumAddress = utils.computeAddress(privateKey)
        this.mode = ""
        this.listeners = {
            join: [],
            part: [],
            message: [],
            error: [],
            close: [],
        }
    }
    startServer() { this.mode = "server" }
    listen() { this.mode = "client" }
    close() { this.mode = "" }
    publish(topic, ...args) {
        for (const func of this.listeners[topic]) {
            func(...args)
        }
        for (const func of this.listeners.message) {
            func(topic, ...args, { messageId: { timestamp: Date.now() }})
        }
    }
    on(topic, cb) {
        this.listeners[topic].push(cb)
    }
}
