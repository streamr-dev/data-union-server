
const express = require("express")
const {
    utils: { getAddress, BigNumber }
} = require("ethers")

const log = require("debug")("Streamr::CPS::routers::dataunion")

/** Convert Ethereum address into checksummed case */
function parseAddress(address) {
    try {
        return getAddress(address)
    } catch (e) {
        return null
    }
}

const router = express.Router()

router.get("/", (req, res) => {
    const state = req.monoplasmaState
    if (state) {
        res.send({ status: "ok" })
    } else {
        res.status(500).send({error: "Faulty operator"})
    }
})

router.get("/stats", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataunionAddress}> Requested community stats`)
    const memberCount = state.getMemberCount()
    const totalEarnings = state.getTotalRevenue()
    const latestBlock = summarizeBlock(this.plasma.getLatestBlock())
    const latestWithdrawableBlock = summarizeBlock(this.plasma.getLatestWithdrawableBlock())
    const result = {
        memberCount,
        totalEarnings,
        latestBlock,
        latestWithdrawableBlock,
    }
    //const stats = state.getStats()
    res.send(result)
})

router.get("/members", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataunionAddress}> Requested monoplasma members`)

    const members = state.getMembers()
    res.send(members)
})

// NOTE: this function gets the highest query load
router.get("/members/:address", (req, res) => {
    const state = req.monoplasmaState
    //log(`HTTP ${state.dataunionAddress}> Requested member ${address}`)

    const address = parseAddress(req.params.address)
    if (!address) {
        res.status(400).send({error: `Bad Ethereum address: ${req.params.address}`})
        return
    }
    log(`HTTP ${req.params.communityAddress}> Requested member ${address}`)
    // TODO: revert to plasma.getMember after monoplasma update
    //const member = state.getMember(address)
    const member = state.getMembers().find(m => m.address === address)
    if (!member) {
        res.status(404).send({error: `Member not found: ${address} in ${req.params.communityAddress}`})
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

module.exports = router
