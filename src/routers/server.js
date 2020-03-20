const express = require("express")
const {
    utils: { getAddress }
} = require("ethers")

const dataunionRouter = require("./dataunion")

const log = require("debug")("Streamr::CPS::routers::server")

/** @type {(server: CommunityProductServer) => express.Router} */
module.exports = (server) => {

    function parseDataunionState(req, res, next) {
        log("Parsing state")
        let address
        try {
            address = getAddress(req.params.dataunionAddress)
        } catch (e) {   // TODO: check it's actually parsing error?
            res.status(400).send({error: `Bad Ethereum address: ${req.params.dataunionAddress}`})
            return
        }

        const community = server.communities[address]
        if (!community) {
            res.status(404).send({error: `We're not operating the community @ ${address}`})
            return
        }
        if (!community.operator) {
            // TODO: track how long starting has been in progress, re-try after a timeout?
            res.status(503).send({error: `Community is being started @ ${address}`, community})
            return
        }

        req.monoplasmaState = community.operator.watcher.plasma
        next()
    }

    function getSummary(req, res) {
        log("Requested server summary")
        const result = {
            config: server.operatorConfig,
            communities: {},
        }
        for (const [address, c] of Object.entries(server.communities)) {
            // is the community already syncing or running?
            if (c.operator) {
                const stats = c.operator.watcher.getStats()
                result.communities[address] = stats
            } else {
                result.communities[address] = {
                    memberCount: { total: 0, active: 0, inactive: 0 },
                    totalEarnings: 0,
                }
            }
            result.communities[address].state = c.state
        }
        res.send(result)
    }

    const router = express.Router()

    router.use("/dataunions/:dataunionAddress", parseDataunionState, dataunionRouter)
    router.use("/communities/:dataunionAddress", parseDataunionState, dataunionRouter)

    router.get("/dataunions", getSummary)
    router.get("/communities", getSummary)

    return router
}
