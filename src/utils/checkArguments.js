const ethers = require("ethers")

function isAddress(address) {
    try {
        ethers.utils.getAddress(address)
    } catch (e) {
        return false
    }
    return true
}

/** Validate contract addresses from user input */
async function throwIfSetButNotContract(eth, address, variableDescription) {
    if (!address) { return }
    return throwIfNotContract(eth, address, variableDescription)
}

/** Validate contract addresses from user input */
async function throwIfNotContract(eth, address, variableDescription) {
    throwIfBadAddress(address, variableDescription)
    if (await eth.getCode(address) === "0x") {
        throw new Error(`${variableDescription || "Error"}: No contract at ${address}`)
    }
}

/** Validate contract addresses from user input */
function throwIfSetButBadAddress(address, variableDescription) {
    if (!address) { return }
    throwIfBadAddress(address, variableDescription)
}

/** Validate addresses from user input */
function throwIfBadAddress(address, variableDescription) {
    if (!isAddress(address)) {
        throw new Error(`${variableDescription || "Error"}: Bad Ethereum address ${address}`)
    }
}

function throwIfNotSet(variable, description) {
    if (typeof variable === "undefined") {
        throw new Error(`${description || "Error"}: Expected a value!`)
    }
}

module.exports = {
    throwIfNotContract,
    throwIfSetButNotContract,
    throwIfBadAddress,
    throwIfSetButBadAddress,
    throwIfNotSet,
}
