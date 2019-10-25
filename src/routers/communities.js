const express = require("express")
const BN = require("bn.js")
const ethers = require("ethers")

/** Convert Ethereum address into checksummed case */
function parseAddress(address) {
    try {
        return ethers.utils.getAddress(address)
    } catch (e) {
        return null
    }
}

/** Don't send the full member list back, only member count */
function blockToApiObject(block) {
    if (!block || !block.members) { block = { members: [] } }
    return {
        blockNumber: block.blockNumber || 0,
        timestamp: block.timestamp || 0,
        memberCount: block.members.length,
        totalEarnings: block.totalEarnings || 0,
    }
}

/** @type {(server: CommunityProductServer, logFunc: Function<String>) => Function} */
module.exports = (server, logFunc) => {
    const log = logFunc || process.env.QUIET ? () => {} : console.log
    const router = express.Router()

    router.get("/", (req, res) => {
        res.send(Object.keys(server.communities))
    })

    function parseOperator(req, res, next) {
        const address = parseAddress(req.params.communityAddress)
        if (!address) {
            res.status(400).send({error: `Bad Ethereum address: ${req.params.communityAddress}`})
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
        req.operator = community.operator
        next()
    }

    // TODO: find a way to delegate to monoplasma/src/routers/member.js
    router.get("/:communityAddress/", parseOperator, (req, res) => {
        const plasma = req.operator.watcher.plasma
        if (plasma) {
            res.send({ status: "ok" })
        } else {
            res.status(500).send({error: "Faulty operator"})
        }
    })

    router.get("/:communityAddress/stats", parseOperator, (req, res) => {
        log(`HTTP ${req.params.communityAddress}> Requested community stats`)
        const plasma = req.operator.watcher.plasma
        const channel = req.operator.watcher.channel
        const joinPartStreamId = channel.stream.id
        const memberCount = plasma.getMemberCount()
        const totalEarnings = plasma.getTotalRevenue()
        const latestBlock = blockToApiObject(plasma.getLatestBlock())
        const latestWithdrawableBlock = blockToApiObject(plasma.getLatestWithdrawableBlock())
        res.send({
            memberCount,
            totalEarnings,
            latestBlock,
            latestWithdrawableBlock,
            joinPartStreamId,
        })
    })

    router.get("/:communityAddress/members", parseOperator, (req, res) => {
        log(`HTTP ${req.params.communityAddress}> Requested monoplasma members`)
        const plasma = req.operator.watcher.plasma
        res.send(plasma.getMembers())
    })

    router.get("/:communityAddress/members/:address", parseOperator, (req, res) => {
        const plasma = req.operator.watcher.plasma
        const address = parseAddress(req.params.address)
        if (!address) {
            res.status(400).send({error: `Bad Ethereum address: ${req.params.address}`})
            return
        }
        log(`HTTP ${req.params.communityAddress}> Requested member ${address}`)
        // TODO: revert to plasma.getMember after monoplasma update
        //const member = plasma.getMember(address)
        const member = plasma.getMembers().find(m => m.address === address)
        if (!member) {
            res.status(404).send({error: `Member not found: ${address} in ${req.params.communityAddress}`})
            return
        }

        const frozenBlock = plasma.getLatestBlock()
        const withdrawableBlock = plasma.getLatestWithdrawableBlock()
        const memberFrozen = frozenBlock ? frozenBlock.members.find(m => m.address === address) || {} : {}
        const memberWithdrawable = withdrawableBlock ? withdrawableBlock.members.find(m => m.address === address) || {} : {}
        member.recordedEarnings = memberFrozen.earnings || "0"
        member.withdrawableEarnings = memberWithdrawable.earnings || "0"
        member.frozenEarnings = new BN(member.recordedEarnings).sub(new BN(member.withdrawableEarnings)).toString(10)
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
