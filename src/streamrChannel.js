const EventEmitter = require("events")
const StreamrClient = require("streamr-client")
const { utils } = require("ethers")

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
 * @typedef {string} Address Ethereum address
 */

/**
 * @typedef {Object} StreamrChannel
 * @property {StreamrClient} client
 * @property {string} streamName
 * @property {string} streamrWsUrl default is "wss://www.streamr.com/api/v1/ws"
 * @property {string} streamrHttpUrl default is "https://www.streamr.com/api/v1"
 * @property {State} mode
 */
module.exports = class StreamrChannel extends EventEmitter {
    constructor(privateKey, joinPartStreamName, streamrWsUrl, streamrHttpUrl) {
        super()
        const opts = {
            auth: { privateKey },
            retryResendAfter: 1000,
        }
        if (streamrWsUrl) { opts.url = streamrWsUrl }
        if (streamrHttpUrl) { opts.restUrl = streamrHttpUrl }
        this.client = new StreamrClient(opts)
        this.joinPartStreamName = joinPartStreamName || `Join-Part-${utils.computeAddress(privateKey).slice(0, 10)}-${Date.now()}`
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

    /**
     * Send a join/part event into the stream
     * @param {string} topic "join" or "part"
     * @param {Array<Address>} addresses that joined/parted
     */
    async publish(topic, addresses) {
        if (this.mode !== State.SERVER) { return Promise.reject(new Error("Must startServer() first!")) }

        return this.stream.publish({
            topic,
            number: this.messageNumber++,
            addresses,
        })
    }

    /**
     * Start listening to events
     * @param {Number} syncStartTimestamp
     * @returns {Promise<ResendResponseResent>} resolves when all events up to now are received
     */
    async listen(syncStartTimestamp) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        const stream = await this.client.getStreamByName(this.joinPartStreamName)
        if (!stream) { return Promise.reject(new Error(`Stream with name "${this.joinPartStreamName}" not found!`)) }

        this.handlers = {}
        this.queue = []
        const sub = this.client.subscribe({
            stream: stream.id,
            resend: {
                from: {
                    timestamp: syncStartTimestamp || 0,
                },
            },
        }, (msg, meta) => {
            this.lastMessageTimestamp = meta.timestamp
            this.lastMessageNumber = msg.number
            this.emit(msg.topic, msg.addresses)
            this.emit("message", msg.topic, msg.addresses, meta)
        })
        sub.on("error", this.emit.bind(this, "error"))

        this.mode = State.CLIENT

        return new Promise((done, fail) => {
            sub.on("error", fail)
            sub.on("resent", done)
            sub.on("no_resend", () => {
                // give some time for retryResendAfter
                setTimeout(done, 1500)
            })
        })
    }

    /** Close the channel */
    close() {
        if (!this.mode) { throw new Error("Can't close, already closed")}
        this.emit("close")
        this.removeAllListeners()
        if (this.client.connection.state !== "disconnected") {
            this.client.disconnect()
        }
        this.mode = State.CLOSED
    }
}
