module.exports = class MockStreamrChannel {
    constructor(apiKey, joinPartStreamName) {
        this.joinPartStreamName = joinPartStreamName || `Join-Part-Mock-${apiKey.slice(0, 2)}-${Date.now()}`
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
    }
    on(topic, cb) {
        this.listeners[topic].push(cb)
    }
}
