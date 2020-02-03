# Management scripts

Set of simple scripts that mostly invoke [the relevant methods in StreamrClient](https://github.com/streamr-dev/streamr-client-javascript/blob/master/src/rest/CommunityEndpoints.js) for the actual community manipulation and inspection.

Their arguments are (mostly) passed as environment variables for the convenience of scripting, deployment, build management etc.

To see what a shell script that invokes these helper scripts might look like, take a look at [`../cps`](../cps) that sets up the scripts to work in the [dockerized development environment](https://github.com/streamr-dev/streamr-docker-dev).

Here's a list of variables `start_server.js` takes:

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
|  STORE_DIR | CPS file storage location, defaults to `store` |
|  QUIET | Don't print to console.log |
|  WEBSERVER_PORT | HTTP API for /config and /communities endpoints |
|  SENTRY_TOKEN | DSN for sending Sentry messages |

It's a good list regarding the rest of the scripts, too (including yet unwritten future scripts that should re-use those variables maximally), though there may be script-specific variables too. Scripts inspecting existing communities use following variables:

| Variable | Notes |
| --- | --- |
| COMMUNITY_ADDRESS | Existing community's smart contract address |
| ETHEREUM_PRIVATE_KEY | Admin's key for admin functions e.g. `add_secret.js` |
| MEMBER_ADDRESS | Fallback alternative to the above e.g. for `check_member.js` |
| SECRET | Community "password" for joining without manual approval from admin |
| SLEEP_MS | Let user double-check the transaction before sending |

List of script-specific interpretations and additions:

| Script(s) | Variable | Notes |
| --- | --- | --- |
| `deploy_community.js` | ADMIN_FEE BLOCK_FREEZE_SECONDS | Monoplasma parameters (optional) |
| `check_member.js` | ETHEREUM_PRIVATE_KEY | Private key of the member to check, not admin |
| `send_tokens.js` | DATA_TOKEN_AMOUNT | |
