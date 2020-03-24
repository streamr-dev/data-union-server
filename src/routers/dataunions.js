const express = require("express")
const {
    utils: { getAddress, BigNumber }
} = require("ethers")

const log = require("debug")("Streamr::dataunion::routers::dataunions")

/** Convert Ethereum address into checksummed case */
function parseAddress(address) {
    try {
        return getAddress(address)
    } catch (e) {
        return null
    }
}

/** @type {(server: DataUnionServer, logFunc: Function<String>) => express.Router} */
module.exports = (server) => {
    const router = express.Router()

    router.get("/", (req, res) => {
        log("Requested server summary")
        const result = {
            config: server.operatorConfig,
            dataunions: {},
        }
        for (const [address, c] of Object.entries(server.communities)) {
            // is the community already syncing or running?
            if (c.operator) {
                const stats = c.operator.watcher.getStats()
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
    })

    function parseOperator(req, res, next) {
        const address = parseAddress(req.params.duAddress)
        if (!address) {
            res.status(400).send({error: `Bad Ethereum address: ${req.params.duAddress}`})
            return
        }
        const community = server.communities[address]
        if (!community) {
            res.status(404).send({error: `We're not operating the data union ${address}`})
            return
        }
        if (!community.operator) {
            // TODO: track how long starting has been in progress, re-try after a timeout?
            res.status(503).send({error: `Community is being started @ ${address}`, community})
            return
        }
        req.operator = community.operator
        next()
    }

    // TODO: find a way to delegate to monoplasma/src/routers/member.js
    router.get("/:duAddress/", parseOperator, (req, res) => {
        const plasma = req.operator.watcher.plasma
        if (plasma) {
            res.send({ status: "ok" })
        } else {
            res.status(500).send({error: "Faulty operator"})
        }
    })

    router.get("/:duAddress/stats", parseOperator, (req, res) => {
        log(`HTTP ${req.params.duAddress}> Requested community stats`)
        const stats = req.operator.watcher.getStats()
        res.send(stats)
    })

    router.get("/:duAddress/members", parseOperator, (req, res) => {
        log(`HTTP ${req.params.duAddress}> Requested monoplasma members`)
        const plasma = req.operator.watcher.plasma
        res.send(plasma.getMembers())
    })

    // NOTE: this function gets the highest query load
    router.get("/:duAddress/members/:address", parseOperator, (req, res) => {
        const plasma = req.operator.watcher.plasma
        const address = parseAddress(req.params.address)
        if (!address) {
            res.status(400).send({error: `Bad Ethereum address: ${req.params.address}`})
            return
        }
        log(`HTTP ${req.params.duAddress}> Requested member ${address}`)
        // TODO: revert to plasma.getMember after monoplasma update
        //const member = plasma.getMember(address)
        const member = plasma.getMembers().find(m => m.address === address)
        if (!member) {
            res.status(404).send({error: `Member not found: ${address} in ${req.params.duAddress}`})
            return
        }

        const frozenBlock = plasma.getLatestBlock()
        const withdrawableBlock = plasma.getLatestWithdrawableBlock()
        const memberFrozen = frozenBlock ? frozenBlock.members.find(m => m.address === address) || {} : {}
        const memberWithdrawable = withdrawableBlock ? withdrawableBlock.members.find(m => m.address === address) || {} : {}
        member.recordedEarnings = memberFrozen.earnings || "0"
        member.withdrawableEarnings = memberWithdrawable.earnings || "0"
        member.frozenEarnings = new BigNumber(member.recordedEarnings).sub(member.withdrawableEarnings).toString()
        if (member.withdrawableEarnings > 0) {
            member.withdrawableBlockNumber = withdrawableBlock.blockNumber
            plasma.getProofAt(address, withdrawableBlock.blockNumber).then(proof => {
                member.proof = proof
                res.send(member)
            }).catch(error => {
                res.send({
                    member,
                    error: `getProofAt(${address}, ${withdrawableBlock.blockNumber}) failed`,
                    errorMessage: error.message,
                })
            })
        } else {
            res.send(member)
        }
    })

    return router
}
