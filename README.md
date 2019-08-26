# Streamr community products server

[![Build Status](https://travis-ci.com/streamr-dev/streamr-community-products.svg?token=9unddqKugX2cPcyhtVxp&branch=master)](https://travis-ci.com/streamr-dev/streamr-community-products)

# Running

`node start_server.js`

Starts a Ganache instance in port 8545, deploys a test token, and starts a web server in port 8080.

Web server answers to following HTTP endpoints, read-only, for inspection purposes:

* GET /config
  * Returns the running server configuration
* GET /communities
  * Returns list of communities the server runs Operators for
* GET /communities/{communityAddress}/stats
  * Returns Operator stats.
* GET /communities/{communityAddress}/members
  * Returns list of members
* GET /communities/{communityAddress}/members/{memberAddress}
  * Returns individual member stats (such as balances and withdraw proofs)

All "writing" happens either through Ethereum contracts or the joinPartStream (see [streamrChannel.js](src/streamrChannel.js))

Start server script can be modified using the following environment variables:
```
    ETHEREUM_SERVER,            // explicitly specify server address
    ETHEREUM_NETWORK,           // use ethers.js default servers
    ETHEREUM_PRIVATE_KEY,
    TOKEN_ADDRESS,
    STREAMR_WS_URL,
    STREAMR_HTTP_URL,

    BLOCK_FREEZE_SECONDS,
    FINALITY_WAIT_SECONDS,
    GAS_PRICE_GWEI,
    //RESET,

    STORE_DIR,
    QUIET,

    DEVELOPER_MODE,

    // these will be used  1) for demo token  2) if TOKEN_ADDRESS doesn't support name() and symbol()
    TOKEN_SYMBOL,
    TOKEN_NAME,

    // if ETHEREUM_SERVER isn't specified, start a local Ethereum simulator (Ganache) in given port
    GANACHE_PORT,

    // HTTP API for /config and /communities endpoints
    WEBSERVER_PORT,

    SENTRY_TOKEN,
```

# Debugging and developing

Run tests with one of the following:
* `npm run test` for all tests
* `npm run unit-tests` for just locally run unit tests of JS source files
* `npm run contract-tests` for smart contract tests
* `npm run integration-tests` for end-to-end tests that talk to internet
