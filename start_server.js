const ethers = require("ethers")

const CommunityProductServer = require("./src/server")

const key = "6E340F41A1C6E03E6E0A4E9805D1CEA342F6A299E7C931D6F3DA6DD34CB6E17D"
const provider = ethers.getDefaultProvider("rinkeby")
const wallet = new ethers.Wallet(key, provider)

const server = new CommunityProductServer(wallet)

server.start().catch(console.error)
