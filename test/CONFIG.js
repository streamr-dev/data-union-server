// Environment defaults that work with testing environment set up by streamr-docker-dev
// See https://github.com/streamr-dev/streamr-docker-dev/blob/master/docker-compose.override.yml

module.exports = {
    STREAMR_WS_URL: "ws://localhost:8890/api/v1/ws",
    STREAMR_HTTP_URL: "http://localhost:8081/streamr-core/api/v1",
    STREAMR_NODE_ADDRESS: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",   // in dev docker
    WEBSERVER_PORT: 8085,
    ETHEREUM_SERVER: "http://localhost:8545",
    // ganache 0 = operator, token owner: 0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1
    OPERATOR_PRIVATE_KEY: "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
    // ganache 1 = data union admin: 0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0
    ETHEREUM_PRIVATE_KEY: "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb",
    TOKEN_ADDRESS: "0xbAA81A0179015bE47Ad439566374F2Bae098686F",
    MARKETPLACE_ADDRESS: "0xEAA002f7Dc60178B6103f8617Be45a9D3df659B6",

    BLOCK_FREEZE_SECONDS: 1,
    OPERATOR_ADDRESS: "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1",      // ganache 0
    ADMIN_FEE: 0.2,
    GAS_PRICE_GWEI: 20,

    DEBUG: "*",
    DEBUG_COLORS: "true",
}
