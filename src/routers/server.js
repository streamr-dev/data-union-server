const express = require("express")

/** @type {(server: CommunityProductServer, logFunc: Function<String>) => express.Router} */
module.exports = (server, logFunc) => {
    const log = logFunc || process.env.QUIET ? () => {} : console.log
    const router = express.Router()

    router.get("/summary", (req, res) => {
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
    })

    return router
}