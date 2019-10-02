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
 * @property {Stream} stream in Streamr where joins and parts are sent
 * @property {State} mode
 */
module.exports = class StreamrChannel extends EventEmitter {
    /**
     * @param {string} privateKey to use for authenticating with Streamr
     * @param {string} joinPartStreamId to try to connect to. If omitted, startServer will create a new stream.
     * @param {string} streamrWsUrl default is "wss://www.streamr.com/api/v1/ws"
     * @param {string} streamrHttpUrl default is "https://www.streamr.com/api/v1"
     */
    constructor(privateKey, joinPartStreamId, streamrWsUrl, streamrHttpUrl) {
        if (!privateKey) { throw new Error("Must supply a private key to new StreamrChannel") }
        super()
        const opts = {
            auth: { privateKey },
            retryResendAfter: 1000,
        }
        if (streamrWsUrl) { opts.url = streamrWsUrl }
        if (streamrHttpUrl) { opts.restUrl = streamrHttpUrl }
        this.client = new StreamrClient(opts)
        this.ethereumAddress = utils.computeAddress(privateKey)
        this.joinPartStreamId = joinPartStreamId
        this.mode = State.CLOSED
    }

    /**
     * After this, call .publish(type, data) to send
     */
    async startServer() {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        this.messageNumber = +Date.now()
        if (this.joinPartStreamId) {
            this.stream = await this.client.getStream(this.joinPartStreamId)
        } else {
            const name = `Join-Part-${this.ethereumAddress.slice(0, 10)}-${Date.now()}`
            this.stream = await this.client.createStream({ name })

            // every watcher should be able to read joins and parts in order to sync the state
            await this.stream.grantPermission("read", null)
        }

        this.mode = State.SERVER
    }

    /**
     * Send a join/part event into the stream
     * @param {string} type "join" or "part"
     * @param {Array<Address>} addresses that joined/parted
     */
    async publish(type, addresses) {
        if (this.mode !== State.SERVER) { return Promise.reject(new Error("Must startServer() first!")) }

        return this.stream.publish({
            type,
            number: this.messageNumber++,
            addresses,
        })
    }

    /**
     * Start listening to events
     * @param {Number} syncStartTimestamp resend messages starting from (0 if omitted)
     * @returns {Promise<ResendResponseResent>} resolves when all events up to now are received
     */
    async listen(syncStartTimestamp) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        this.stream = await this.client.getStream(this.joinPartStreamId)   // will throw if joinPartStreamId is bad

        this.handlers = {}
        this.queue = []
        const sub = this.client.subscribe({
            stream: this.stream.id,
            resend: {
                from: {
                    timestamp: syncStartTimestamp || 0,
                    sequenceNumber: 0,
                },
            },
        }, (msg, meta) => {
            this.lastMessageTimestamp = meta.timestamp
            this.lastMessageNumber = msg.number
            this.emit(msg.type, msg.addresses)
            this.emit("message", msg.type, msg.addresses, meta)
        })
        sub.on("error", this.emit.bind(this, "error"))

        this.mode = State.CLIENT

        return new Promise((done, fail) => {
            sub.on("error", fail)
            sub.on("resent", done)
            sub.on("no_resend", () => {
                // give some time for retryResendAfter
                // TODO: should rely on "resent" event instead
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
