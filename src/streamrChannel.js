const StreamrClient = require("streamr-client")

/**
 * @typedef {string} State
 * @enum {string}
 */
const State = {
    CLOSED: "",
    SERVER: "server",
    CLIENT: "client",
}

/**
 * @typedef {Object} StreamrChannel
 * @property {StreamrClient} client
 * @property {string} streamName
 * @property {State} mode
 */
module.exports = class StreamrChannel {
    constructor(streamrApiKey, joinPartStreamName) {
        this.client = new StreamrClient({
            apiKey: streamrApiKey,
            url: "wss://ee-staging.streamr.com/api/v1/ws",
            restUrl: "https://ee-staging.streamr.com/api/v1",
        })
        this.joinPartStreamName = joinPartStreamName || `Join-Part-${streamrApiKey.slice(0, 2)}-${Date.now()}`
        this.mode = State.CLOSED
    }

    /** After this, call .publish(topic, data) to send */
    async startServer() {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        this.messageNumber = +Date.now()
        this.stream = await this.client.getOrCreateStream({
            name: this.joinPartStreamName,
            public: true,
        })
        this.mode = State.SERVER
    }

    async publish(topic, addresses) {
        if (this.mode !== State.SERVER) { return Promise.reject(new Error("Must startServer() first!")) }

        const number = this.messageNumber++
        const addressList = JSON.stringify(addresses)
        return this.stream.publish({
            topic,
            number,
            addressList,
        })
    }

    /** After this, add a listener for specific topic: .on(topic, msg => { handler } ) */
    async listen() {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        const stream = await this.client.getStreamByName(this.joinPartStreamName)
        if (!stream) { return Promise.reject(new Error(`Stream with name "${this.joinPartStreamName}" not found!`)) }

        this.handlers = {}
        this.client.subscribe({
            stream: stream.id,
            //resend: { resend_all: true, },
        }, msg => {
            // TODO: track msg.number, at least warn if inconsistent?
            const callbacks = this.handlers[msg.topic]
            if (!callbacks) { return }
            for (const cb of callbacks) {
                if (cb instanceof Function) {
                    const addresses = JSON.parse(msg.addressList)
                    cb(addresses)
                }
            }
        })

        this.mode = State.CLIENT
    }

    on(topic, callback) {
        if (this.mode !== State.CLIENT) { return Promise.reject(new Error("Must listen() first!")) }

        if (!(topic in this.handlers)) { this.handlers[topic] = [] }
        this.handlers[topic].push(callback)
    }

    /** Close the channel */
    close() {
        if (!this.mode) { throw new Error("Can't close, already closed")}

        this.client.disconnect()
        this.mode = State.CLOSED
    }
}
