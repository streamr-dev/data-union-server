const EventEmitter = require("events")
const StreamrClient = require("streamr-client")
const { utils: { computeAddress } } = require("ethers")
const debug = require("debug")("CPS::StreamrChannel")

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
        this.clientOptions = { retryResendAfter: 1000 }
        if (streamrWsUrl) { this.clientOptions.url = streamrWsUrl }
        if (streamrHttpUrl) { this.clientOptions.restUrl = streamrHttpUrl }
        this.joinPartStreamId = joinPartStreamId
        this.mode = State.CLOSED
    }

    // TODO: use StreamrClient.deployCommunity instead
    static async create(privateKey, streamrWsUrl, streamrHttpUrl) {

        const clientOptions = Object.assign({}, this.clientOptions, {
            auth: { privateKey }
        })
        const client = new StreamrClient(clientOptions)

        const name = `Join-Part-${this.ethereumAddress.slice(0, 10)}-${Date.now()}`
        const stream = await client.createStream({ name })
        debug(`Stream created: ${JSON.stringify(stream.toObject())}`)

        const res1 = await stream.grantPermission("read", null)
        debug(`Grant read permission response from server: ${JSON.stringify(res1)}`)
        //TODO, or just use deployCommunity
        //const res2 = await stream.grantPermission("write", streamrNodeAddress)
        //debug(`Grant write permission response to ${streamrNodeAddress} from server: ${JSON.stringify(res2)}`)

        const channel = new StreamrChannel(stream.id, streamrWsUrl, streamrHttpUrl)
        return channel
    }

    static async open(joinPartStreamId, streamrWsUrl, streamrHttpUrl) {
        // check joinPartStream exists
        const client = new StreamrClient(this.clientOptions)
        await client.getStream(joinPartStreamId).catch(e => { throw new Error(`joinPartStream ${joinPartStreamId} is not found in Streamr (error: ${e.stack.toString()})`) })
        await client.ensureDisconnected()

        return new StreamrChannel(joinPartStreamId, streamrWsUrl, streamrHttpUrl)
    }

    /**
     * After this, call .publish(type, data) to send
     */
    async startServer(privateKey) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}
        if (!privateKey) { throw new Error("Must supply a private key to startServer") }
        this.ethereumAddress = computeAddress(privateKey)
        debug(`Starting server as ${this.ethereumAddress}`)

        this.clientOptions.auth = { privateKey }
        this.client = new StreamrClient(this.clientOptions)

        this.messageNumber = +Date.now()
        this.stream = await this.client.getStream(this.joinPartStreamId)

        debug(`Writing to stream ${JSON.stringify(this.stream.toObject())}`)
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
     * @returns {Promise<ResendResponseResent>} resolves when all events up to now are received
     */
    async listen(syncStartTimestamp) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}

        this.client = new StreamrClient(this.clientOptions)
        this.stream = await this.client.getStream(this.joinPartStreamId) // will throw if joinPartStreamId is bad

        this.handlers = {}
        this.queue = []
        const sub = this.client.subscribe({
            stream: this.stream.id,
            resend: {
                from: {
                    timestamp: syncStartTimestamp || 1,
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
    async close() {
        if (this.mode === State.CLOSED) { throw new Error("Can't close, already closed")}
        this.emit("close")
        this.removeAllListeners()
        await this.client.ensureDisconnected()
        this.mode = State.CLOSED
    }
}
