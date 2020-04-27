const express = require("express")
const {
    utils: { getAddress }
} = require("ethers")

const dataUnionRouter = require("./dataunion")

const log = require("debug")("Streamr::dataunion::routers::server")

/** @type {(server: DataUnionServer) => express.Router} */
module.exports = (server) => {

    function parseDataUnionState(req, res, next) {
        log("Parsing state")
        let address
        try {
            address = getAddress(req.params.dataUnionAddress)
        } catch (e) {   // TODO: check it's actually parsing error?
            res.status(400).send({error: `Bad Ethereum address: ${req.params.dataUnionAddress}`})
            return
        }

        const dataUnion = server.dataUnions[address]
        if (!dataUnion) {
            res.status(404).send({error: `We're not operating the data union @ ${address}`})
            return
        }
        if (!dataUnion.operator) {
            // TODO: track how long starting has been in progress, re-try after a timeout?
            res.status(503).send({error: `dataUnion is being started @ ${address}`, dataUnion})
            return
        }

        req.monoplasmaState = dataUnion.operator.watcher.plasma
        req.joinPartStreamId = dataUnion.operator.watcher.channel.stream.id
        next()
    }

    function getSummary(req, res) {
        log("Requested server summary")
        const result = {
            config: server.operatorConfig,
            dataunions: {},
        }
        for (const [address, c] of Object.entries(server.dataUnions)) {
            // is the data union already syncing or running?
            if (c.operator) {
                const stats = dataUnionRouter.getStats(c.operator.watcher.plasma)
                stats.joinPartStreamId = c.operator.watcher.channel.stream.id
                result.dataunions[address] = stats
            } else {
                result.dataunions[address] = {
                    memberCount: { total: 0, active: 0, inactive: 0 },
                    totalEarnings: 0,
                }
            }
            result.dataunions[address].state = c.state
        }
        res.send(result)
    }

    const router = express.Router()

    router.use("/dataunions/:dataUnionAddress", parseDataunionState, dataunionRouter)
    router.use("/dataunions/:dataUnionAddress", parseDataunionState, dataunionRouter)

    router.get("/dataunions", getSummary)
    router.get("/dataUnions", getSummary)

    return router
}
