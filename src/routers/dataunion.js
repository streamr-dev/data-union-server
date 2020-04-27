
const express = require("express")
const {
    utils: { getAddress, BigNumber }
} = require("ethers")

const log = require("debug")("Streamr::dataunion::routers::dataunion")

/** Convert Ethereum address into checksummed case */
function parseAddress(address) {
    try {
        return getAddress(address)
    } catch (e) {
        return null
    }
}

/**
 * @typedef {Object} BlockSummary
 * @property {Number} blockNumber
 * @property {Number} timestamp when the Monoplasma block was stored, NOT Ethereum block timestamp
 * @property {Number} memberCount
 * @property {Number} totalEarnings
 */

/**
 * Don't send the full member list back, only member count
 * @returns {BlockSummary}
 */
function summarizeBlock(block) {
    if (!block || !block.members) { block = { members: [] } }
    return {
        blockNumber: block.blockNumber || 0,
        timestamp: block.timestamp || 0,
        memberCount: block.members.length,
        totalEarnings: block.totalEarnings || 0,
    }
}

/**
 * Returns the "real-time plasma" stats
 * @returns {Object} summary of different stats and config of the data union the watcher is watching
 */
function getStats(monoplasmaState) {
    const memberCount = monoplasmaState.getMemberCount()
    const totalEarnings = monoplasmaState.getTotalRevenue()
    const latestBlock = summarizeBlock(monoplasmaState.getLatestBlock())
    const latestWithdrawableBlock = summarizeBlock(monoplasmaState.getLatestWithdrawableBlock())
    return {
        memberCount,
        totalEarnings,
        latestBlock,
        latestWithdrawableBlock,
    }
}

const router = express.Router()

router.get("/", (req, res) => {
    const {
        monoplasmaState,
        joinPartStreamId,
    } = req
    if (monoplasmaState) {
        res.send({
            joinPartStreamId
        })
    } else {
        res.status(500).send({
            error: "Operator state is falsy"
        })
    }
})

router.get("/stats", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataUnionAddress}> Requested data union stats`)
    const result = getStats(state)
    res.send(result)
})

router.get("/members", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataUnionAddress}> Requested monoplasma members`)

    const members = state.getMembers()
    res.send(members)
})

// NOTE: this function gets the highest query load
router.get("/members/:address", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataUnionAddress}> Requested member ${address}`)

    const address = parseAddress(req.params.address)
    if (!address) {
        res.status(400).send({error: `Bad Ethereum address: ${req.params.address}`})
        return
    }
    log(`HTTP ${req.params.dataUnionAddress}> Requested member ${address}`)
    // TODO: revert to plasma.getMember after monoplasma update
    //const member = state.getMember(address)
    const member = state.getMembers().find(m => m.address === address)
    if (!member) {
        res.status(404).send({error: `Member not found: ${address} in ${req.params.dataUnionAddress}`})
        return
    }

    const frozenBlock = state.getLatestBlock()
    const withdrawableBlock = state.getLatestWithdrawableBlock()
    const memberFrozen = frozenBlock ? frozenBlock.members.find(m => m.address === address) || {} : {}
    const memberWithdrawable = withdrawableBlock ? withdrawableBlock.members.find(m => m.address === address) || {} : {}
    member.recordedEarnings = memberFrozen.earnings || "0"
    member.withdrawableEarnings = memberWithdrawable.earnings || "0"
    member.frozenEarnings = new BigNumber(member.recordedEarnings).sub(member.withdrawableEarnings).toString()
    if (member.withdrawableEarnings > 0) {
        member.withdrawableBlockNumber = withdrawableBlock.blockNumber
        state.getProofAt(address, withdrawableBlock.blockNumber).then(proof => {
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

/**
 * The point of this function is to be able to generate a "constant state" middleware for given state
 * Example usage: `router.get("/route", dataunionRouter.setState(myDataunion.watcher.plasma), dataunionRouter)`
 **/
router.setState = state => (req, res, next) => {
    req.monoplasmaState = state
    next()
}

/**
 * The point of this function is to be able to generate a "constant dataunion" middleware for given dataunion watcher
 * Example usage: `router.get("/route", dataunionRouter.setWatcher(myDataunion.watcher), dataunionRouter)`
 **/
router.setWatcher = watcher => (req, res, next) => {
    req.monoplasmaState = watcher.plasma
    next()
}

router.getStats = getStats

module.exports = router
