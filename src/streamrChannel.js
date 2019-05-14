const EventEmitter = require("events")
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
 * @typedef {string} Address Ethereum address
 */

/**
 * @typedef {Object} StreamrChannel
 * @property {StreamrClient} client
 * @property {string} streamName
 * @property {State} mode
 */
module.exports = class StreamrChannel extends EventEmitter {
    constructor(apiKey, joinPartStreamName) {
        super()
        this.client = new StreamrClient({ apiKey })
        this.joinPartStreamName = joinPartStreamName || `Join-Part-${apiKey.slice(0, 2)}-${Date.now()}`
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
                timestamp: syncStartTimestamp || 0,
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
            sub.on("no_resend", done)

            // TODO: remove this hack after finding out why neither "resent" nor "no_resend" happens
            setTimeout(done, 100)
        })
    }

    /** Close the channel */
    close() {
        if (!this.mode) { throw new Error("Can't close, already closed")}
        this.emit("close")
        this.removeAllListeners()
        this.client.disconnect()
        this.mode = State.CLOSED
    }
}
