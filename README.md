# Streamr Data Union server

**Warning: this repository is related to Data Unions framework version 1, which is now obsolete. From version 2.0 onwards, the framework no longer requires this centralized server component, and runs fully on-chain instead. You can find the smart contracts [here](https://github.com/streamr-dev/data-union).**

# Running

`node scripts/start_server.js`

Starts a Ganache instance in port 8545, deploys a test token, and starts a web server in port 8080.

Web server answers to following HTTP endpoints, read-only, for inspection purposes:

* GET /config
  * Returns the running server configuration
* GET /dataunions
  * Returns list of data unions the server runs Operators for
* GET /dataunions/{dataUnionAddress}/stats
  * Returns Operator stats.
* GET /dataunions/{dataUnionAddress}/members
  * Returns list of members
* GET /dataunions/{dataUnionAddress}/members/{memberAddress}
  * Returns individual member stats (such as balances and withdraw proofs)

All "writing" happens either through Ethereum contracts or the joinPartStream (see [streamrChannel.js](src/streamrChannel.js))

Start server script can be modified using the following environment variables:

| Variable | Notes |
| --- | --- |
|  ETHEREUM_SERVER | explicitly specify server address |
|  ETHEREUM_NETWORK | fallback alternative to the above, use ethers.js default servers |
|  OPERATOR_PRIVATE_KEY | private key of the operators, used for identifying which contracts we should be serving |
|  TOKEN_ADDRESS | $DATA token address |
|  STREAMR_WS_URL | Default: wss://www.streamr.com/api/v1/ws |
|  STREAMR_HTTP_URL | Default: https://www.streamr.com/api/v1 |
|  FINALITY_WAIT_SECONDS | Seconds to wait before assuming Ethereum won't re-org anymore |
|  GAS_PRICE_GWEI | Gas price for Ethereum transactions, defaults to network suggestion ([see ethers.js](https://github.com/ethers-io/ethers.js/blob/061b0eae1d4c570aedd9bee1971afa43fcdae1a6/tests/make-tests/make-contract-interface.js#L330)) |
|  STORE_DIR | dataunion file storage location, defaults to `store` |
|  QUIET | Don't print to console.log |
|  WEBSERVER_PORT | HTTP API for /config and /dataunions endpoints |
|  SENTRY_TOKEN | DSN for sending Sentry messages |

# Debugging and developing

Use Node 12.16.1 and npm 6.14.1.

Run tests with one of the following:
* `npm run test` for all tests that should currently pass
* `npm run unit-tests` for just locally run unit tests of JS source files
* `npm run integration-tests` for end-to-end tests that run against [Docker environment](https://github.com/streamr-dev/streamr-docker-dev)
* `npm run system-tests` for end-to-end tests that run against Docker environment
* `npm run contract-tests` for smart contract tests

Note: STREAMR_WS_URL and STREAMR_HTTP_URL really should be set for integration-tests and system-tests, otherwise they'll contact production instances
