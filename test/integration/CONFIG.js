// integration test configs from env
/*
module.exports = {
    streamrWs: process.env.STREAMR_WS_URL || process.env.WEBSOCKET_URL, // default is production
    streamrHttp: process.env.STREAMR_HTTP_URL || process.env.REST_URL,  // default is production
    streamrNodeAddress: process.env.STREAMR_NODE_ADDRESS || "0xc0aa4dC0763550161a6B59fa430361b5a26df28C", // node address in production
}
*/
module.exports = {
    streamrWs: "ws://localhost:8890/api/v1/ws",
    streamrHttp: "http://localhost:8081/streamr-core/api/v1",
    streamrNodeAddress: "0xc0dBcc4e7a0e0BEF78Da67AC2CD5Ca2Dd3c4C165",
}
