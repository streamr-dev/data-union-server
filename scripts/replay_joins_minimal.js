const StreamrClient = require("streamr-client")
new StreamrClient({
    retryResendAfter: 1000,
    orderMessages: false,
}).subscribe({
    stream: "gT4g0ZkiQ9GB_eWKN7DM9w",
    resend: {
        from: {
            timestamp: 1
        }
    }
}, (message) => {
    if (!Array.isArray(message.addresses)) {
        console.error("Bad message: " + JSON.stringify(message))
        return
    }
    message.addresses.forEach(address => {
        console.log(`${message.type} ${address}`)
    })
}).on("resent", () => process.exit(0))
setTimeout(() => process.exit(1), 10 * 60 * 1000)