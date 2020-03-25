const express = require("express")
const {
    utils: { getAddress }
} = require("ethers")

module.exports = channel => {
    const router = express.Router()

    router.get("/", (req, res) => {
        res.send({
            status: "ok",
        })
    })

    router.post("/members", (req, res) => {
        const rawAddresses = Array.isArray(req.body) ? req.body : [req.body]
        if (rawAddresses.length < 1) {
            res.status(400).send({error: "Must provide at least one member object to add!"})
            return
        }

        const addresses = []
        for (const a of rawAddresses) {
            try {
                addresses.push(getAddress(a))
            } catch (e) {
                res.status(400).send({error: `Bad Ethereum address when adding members: ${a}`})
                return
            }
        }

        channel.publish("join", addresses)
        res.set("Location", `${req.url}/${addresses[0].address || addresses[0]}`).status(201).send({
            status: "Join sent"
        })
    })

    router.delete("/members/:address", (req, res) => {
        let address
        try {
            address = getAddress(req.params.address)
        } catch (e) {
            res.status(400).send({error: `Bad Ethereum address: ${req.params.address}`})
            return
        }

        channel.publish("part", [address])
        res.status(204).send()
    })

    return router
}