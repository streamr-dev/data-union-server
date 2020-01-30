const { utils } = require("ethers")

module.exports = class MockStreamrChannel {
    constructor(joinPartStreamId/*, streamrWsUrl, streamrHttpUrl*/) {
        this.stream = {
            id: joinPartStreamId,
            name: "Join-Part-Stream-Mock",
        }
        this.mode = ""
        this.listeners = {
            join: [],
            part: [],
            message: [],
            error: [],
            close: [],
        }
        this.pastEventsWithTimestamps = []
    }
    startServer(privateKey) {
        this.ethereumAddress = utils.computeAddress(privateKey)
        this.mode = "server"
    }
    listen() {
        this.pastEventsWithTimestamps.forEach(e => {
            this.publishAt(...e)
        })
        this.mode = "client"
    }
    isClosed() { return this.mode === "" }
    close() { this.mode = "" }
    publish(type, ...args) {
        this.publishAt(Date.now(), type, ...args)
    }
    publishAt(timestamp, type, ...args) {
        for (const func of this.listeners[type]) {
            func(...args)
        }
        for (const func of this.listeners.message) {
            func(type, ...args, { messageId: { timestamp }})
        }
    }
    on(type, cb) {
        this.listeners[type].push(cb)
    }
}
