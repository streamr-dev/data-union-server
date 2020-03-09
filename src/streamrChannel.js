const EventEmitter = require("events")
const StreamrClient = require("streamr-client")
const { utils: { computeAddress } } = require("ethers")
const log = require("debug")("Streamr::CPS::StreamrChannel")

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
     * @param {string} joinPartStreamId to try to connect to
     * @param {string} streamrWsUrl default is "wss://www.streamr.com/api/v1/ws"
     * @param {string} streamrHttpUrl default is "https://www.streamr.com/api/v1"
     */
    constructor(joinPartStreamId, streamrWsUrl, streamrHttpUrl) {
        super()
        this.clientOptions = {
            orderMessages: false,
            retryResendAfter: 1000,
        }
        if (streamrWsUrl) { this.clientOptions.url = streamrWsUrl }
        if (streamrHttpUrl) { this.clientOptions.restUrl = streamrHttpUrl }
        this.joinPartStreamId = joinPartStreamId
        this.mode = State.CLOSED
    }

    /**
     * Just check if the joinPartStream exists
     */
    async isValid() {
        const client = new StreamrClient(this.clientOptions)
        const res = await client.getStream(this.joinPartStreamId).catch(e => e)
        await client.ensureDisconnected()
        return !(res instanceof Error)
    }

    /**
     * After this, call .publish(type, data) to send
     */
    async startServer(privateKey) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}
        if (!privateKey) { throw new Error("Must supply a private key to startServer") }
        this.ethereumAddress = computeAddress(privateKey)
        log(`Starting server as ${this.ethereumAddress}`)

        this.clientOptions.auth = { privateKey }
        this.client = new StreamrClient(this.clientOptions)
        this.stream = await this.client.getStream(this.joinPartStreamId) // will throw if joinPartStreamId is bad

        // TODO: throw if client doesn't have write permission to the stream

        log(`Writing to stream ${JSON.stringify(this.stream.toObject())}`)
        this.messageNumber = +Date.now()
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
     * @param {Number} syncStartTimestamp resend messages starting from (from beginning if omitted)
     * @param {Number} playbackTimeoutMs give up with error after timeout (default 10 minutes)
     * @returns {Promise<ResendResponseResent>} resolves when all events up to now are received
     */
    async listen(syncStartTimestamp, playbackTimeoutMs = 600000) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        this.client = new StreamrClient(this.clientOptions)
        this.stream = await this.client.getStream(this.joinPartStreamId) // will throw if joinPartStreamId is bad

        const self = this
        function emitMessage(msg, meta) {
            self.lastMessageTimestamp = meta.messageId.timestamp
            self.lastMessageNumber = msg.number
            self.emit(msg.type, msg.addresses)
            self.emit("message", msg.type, msg.addresses, meta)
        }

        log(`Starting playback of ${this.stream.id}`)

        const queue = []
        const sub = this.client.subscribe({
            stream: this.stream.id,
            resend: {
                from: {
                    timestamp: syncStartTimestamp || 1,
                    sequenceNumber: 0,
                },
            },
        }, (msg, meta) => {
            const len = queue.push({msg, meta})
            log(`Got message ${JSON.stringify(msg)}, queue length = ${len}}`)
        })

        sub.on("error", this.emit.bind(this, "error"))

        await new Promise((done, fail) => {
            sub.on("error", fail)
            sub.on("resent", done)
            sub.on("no_resend", done)
            setTimeout(fail, playbackTimeoutMs)
        })
        log(`Playback of ${this.stream.id} done`)

        // TODO: remove this hack and just emit messages directly from realtime stream
        this.consumerInterval = setInterval(() => {
            if (queue.length < 1) { return }
            const {msg, meta} = queue.shift()
            log(`Sending message ${JSON.stringify(msg)}, queue length = ${queue.length}}`)
            emitMessage(msg, meta)
        }, 100)

        this.mode = State.CLIENT
    }

    isClosed() {
        return this.mode === State.CLOSED
    }

    /** Close the channel */
    async close() {
        if (this.mode === State.CLOSED) { throw new Error("Can't close, already closed")}
        clearInterval(this.consumerInterval)
        this.emit("close")
        this.removeAllListeners()
        await this.client.ensureDisconnected()
        this.mode = State.CLOSED
    }
}
