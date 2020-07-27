const EventEmitter = require("events")
const StreamrClient = require("streamr-client")
const { utils: { computeAddress } } = require("ethers")
const debug = require("debug")

const until = require("./utils/await-until")

/**
 * @typedef {string} State
 * @enum {string}
 */
const State = {
    CLOSED: "",
    SERVER: "server",
    CLIENT: "client",
}

/** Read-only clients for watchers */
const sharedClients = {}

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
        this.log = debug("Streamr::dataunion::StreamrChannel").extend(`StreamId.${this.joinPartStreamId}`)
        this.on("error", (error) => {
            this.log(error)
        })
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
     * @returns {Promise<void>} that resolves when publishing can be done
     */
    async startServer(privateKey) {
        if (this.mode) { return Promise.reject(new Error(`Already started as ${this.mode}`))}
        if (!privateKey) { throw new Error("Must supply a private key to startServer") }
        this.ethereumAddress = computeAddress(privateKey)
        this.log = debug("Streamr::dataunion::StreamrChannel").extend(this.ethereumAddress) // change logger to prefix with eth address
        this.log("Starting server")

        this.clientOptions.auth = { privateKey }
        this.client = new StreamrClient(this.clientOptions)
        this.stream = await this.client.getStream(this.joinPartStreamId) // will throw if joinPartStreamId is bad

        // TODO: throw if client doesn't have write permission to the stream

        this.log("Writing to stream", this.stream.toObject())
        this.messageNumber = +Date.now()
        this.mode = State.SERVER
    }

    /**
     * Send a join/part event into the stream
     * @param {string} type "join" or "part"
     * @param {Array<Address> | Address} addresses that joined/parted
     */
    async publish(type, addresses) {
        if (this.mode !== State.SERVER) { return Promise.reject(new Error("Must startServer() first!")) }
        if (typeof addresses === "string") { addresses = [addresses] }
        this.log("Publishing", { type, addresses })

        return this.stream.publish({
            type,
            number: this.messageNumber++,
            addresses,
        })
    }

    /**
     * Start listening to events
     * @param {Number} syncStartTimestampMs resend messages starting from (from beginning if omitted)
     * @param {Number} playbackTimeoutMs give up with error after timeout (default 10 minutes)
     * @returns {Promise<ResendResponseResent>} resolves when all events up to now are received
     */
    async listen(syncStartTimestampMs, playbackTimeoutMs = 600000) {
        if (this.mode) { throw new Error(`Already started as ${this.mode}`) }

        // share the client on each Streamr server. Authentication doesn't matter since all joinPartStreams should be public
        if (!sharedClients[this.clientOptions.url]) {
            sharedClients[this.clientOptions.url] = new StreamrClient(this.clientOptions)
        }
        this.client = sharedClients[this.clientOptions.url]
        this.stream = await this.client.getStream(this.joinPartStreamId) // will throw if joinPartStreamId is bad

        // swash cache hack; TODO: generalize?
        if (this.joinPartStreamId === "szZk2t2JTZylrRwN6CYJNg") {
            try {
                this.log(`Reading cached events for ${this.joinPartStreamId}`)
                const rawCache = require(`../cache/stream-${this.joinPartStreamId}.json`)
                this.log(`Found ${rawCache.length} events from cache`)
                const cachedEvents = rawCache.filter(e => e.timestamp >= syncStartTimestampMs)
                if (cachedEvents.length < 1) {
                    this.log("Nothing to play back")
                } else {
                    this.log(`Playing back ${cachedEvents.length} cached events`)
                    for (const {type, addresses, timestamp} of cachedEvents) {
                        this.emit(type, addresses)
                        this.emit("message", type, addresses, { messageId: { timestamp } })
                    }
                    syncStartTimestampMs = cachedEvents.slice(-1)[0].timestamp + 1
                }
            } catch (err) {
                this.log("Error when reading from cache", err)
            }
        }

        const self = this
        function emitMessage(msg, meta) {
            if (!msg.type) { throw new Error("JoinPartStream message must have a 'type'") }
            self.lastMessageTimestamp = meta.messageId.timestamp
            self.lastMessageNumber = msg.number
            const addresses =
                !msg.addresses ? [] :
                msg.addresses.constructor.name !== "Array" ? [msg.addresses] :
                msg.addresses
            self.emit(msg.type, addresses)
            self.emit("message", msg.type, addresses, meta)
        }

        this.log(`Starting playback from ${syncStartTimestampMs}(${new Date(syncStartTimestampMs).toString()})`)

        const queue = []
        const sub = this.client.subscribe({
            stream: this.stream.id,
            resend: {
                from: {
                    timestamp: syncStartTimestampMs || 1,
                    sequenceNumber: 0,
                },
            },
        }, (msg, meta) => {
            const len = queue.push({ msg, meta })
            this.log(`Got message, queue length = ${len}}`, msg)
        })

        sub.on("error", this.emit.bind(this, "error"))

        await new Promise((done, fail) => {
            sub.once("error", fail)
            //sub.on("resent", done)
            //sub.on("no_resend", done)
            // possible substitute to two lines above:
            const t = setTimeout(() => fail(new Error(`Playback timed out after ${playbackTimeoutMs}ms for stream: ${this.stream.id}`)), playbackTimeoutMs)
            sub.once("initial_resend_done", () => {
                clearTimeout(t)
                done()
            })
        })
        this.log("Playback done.")

        // TODO: remove this hack and just emit messages directly from realtime stream
        this.consumerInterval = setInterval(() => {
            if (queue.length < 1) { return }
            const {msg, meta} = queue.shift()
            this.log(`Sending message, queue length = ${queue.length}}`, msg)
            try {
                emitMessage(msg, meta)
            } catch (error) {
                this.log("Error sending message.", { error, msg })
            }
        }, 10)

        // fix a problem caused by the above hack by waiting until queue is empty
        await until(() => queue.length < 1, playbackTimeoutMs)

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
