module.exports = {
    urls: {
        ws: process.env.STREAMR_WS_URL || process.env.WEBSOCKET_URL, // || "ws://localhost:8890/api/v1/ws",
        http: process.env.STREAMR_HTTP_URL || process.env.REST_URL, // || "http://localhost:8081/streamr-core/api/v1",
    }
}
