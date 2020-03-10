/* eslint-disable no-bitwise */

const { utils: { solidityKeccak256, } } = require("ethers")

const sleep = require("../utils/sleep-promise")

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000"

/**
 * Hash a member's data in the merkle tree leaf
 * Corresponding code in BalanceVerifier.sol:
 *   bytes32 leafHash = keccak256(abi.encodePacked(account, balance, blockNumber));
 * @param {MonoplasmaMember} member
 * @param {Number} salt e.g. blockNumber
 * @returns {String} keccak256 hash
 */
function hashLeaf(member, salt) {
    return solidityKeccak256(["address", "uint256", "uint256"], [member.address, member.earnings.toString(), salt])
}

/**
 * Hash intermediate branch nodes together
 * @param {String} data1 left branch
 * @param {String} data2 right branch
 * @returns {String} keccak256 hash
 */
function hashCombined(data1, data2) {
    return data1 < data2 ?
        solidityKeccak256(["uint256", "uint256"], [data1, data2]) :
        solidityKeccak256(["uint256", "uint256"], [data2, data1])
}

const MAX_POW_2 = Math.pow(2, 32)
function roundUpToPowerOfTwo(x) {
    if (x > MAX_POW_2) {
        // guard against infinite loop
        throw new Error(`Number too big: ${x}. Must be smaller than 2^32.`)
    }
    let i = 1
    while (i < x) { i <<= 1 }
    return i
}

/** @typedef {String} EthereumAddress */

/**
 * @typedef {Object} MerkleTree
 * @property {Array<String>} hashes
 * @property {Map<EthereumAddress, Number>} indexOf the index of given address in the hashes array
 */

/**
 * Calculate the Merkle tree hashes
 * @param {Array<MonoplasmaMember>} leafContents
 * @returns {MerkleTree} hashes in the tree
 */
async function buildMerkleTree(leafContents, salt) {
    const leafCount = leafContents.length + (leafContents.length % 2)   // room for zero next to odd leaf
    const branchCount = roundUpToPowerOfTwo(leafCount)
    const treeSize = branchCount + leafCount
    const hashes = new Array(treeSize)
    const indexOf = {}
    hashes[0] = branchCount

    // leaf hashes: hash(blockNumber + address + balance)
    let i = branchCount
    leafContents.forEach(member => {
        indexOf[member.address] = i
        hashes[i++] = hashLeaf(member, salt) // eslint-disable-line no-plusplus
    })

    // Branch hashes: start from leaves, populate branches with hash(hash of left + right child)
    // Iterate start...end each level in tree, that is, indices 2^(n-1)...2^n
    for (let startI = branchCount, endI = treeSize; startI > 1; endI = startI, startI >>= 1) {
        let sourceI = startI
        let targetI = startI >> 1
        while (sourceI < endI) {
            const hash1 = hashes[sourceI]
            const hash2 = hashes[sourceI + 1]
            if (!hash1) {                   // end of level in tree because rest are missing
                break
            } else if (!hash2) {            // odd node in the end
                hashes[sourceI + 1] = ZERO  // add zero on the path
                hashes[targetI] = hash1     // no need to hash since no new information was added
                break
            } else {
                hashes[targetI] = hashCombined(hash1, hash2)
            }
            sourceI += 2
            targetI += 1
        }
        await sleep(0)
    }

    return { hashes, indexOf }
}

class MerkleTree {
    constructor(initialContents = [], initialSalt = 0) {
        this.update(initialContents, initialSalt)
    }

    /**
     * Lazy update, the merkle tree is recalculated only when info is asked from it
     * @param newContents list of MonoplasmaMembers
     * @param {String | Number} newSalt a number or hex string, e.g. blockNumber
     */
    update(newContents, newSalt) {
        this.isDirty = true
        this.contents = newContents
        this.salt = newSalt
    }

    async getContents() {
        if (this.contents.length === 0) {
            throw new Error("Can't construct a MerkleTree with empty contents!")
        }
        if (this.isDirty) {
            // TODO: sort, to enforce determinism?
            this.cached = await buildMerkleTree(this.contents, this.salt)
            this.isDirty = false
        }
        return this.cached
    }

    includes(address) {
        return this.contents.find((m) => m.address === address)
    }

    /**
     * Construct a "Merkle path", that is list of "other" hashes along the way from leaf to root
     * This will be sent to the root chain contract as a proof of balance
     * @param address of the balance that the path is supposed to verify
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    async getPath(address) {
        const { hashes, indexOf } = await this.getContents()
        const index = indexOf[address]
        if (!index) {
            throw new Error(`Address ${address} not found!`)
        }
        const path = []
        for (let i = index; i > 1; i >>= 1) {
            let otherSibling = hashes[i ^ 1]
            if (otherSibling !== ZERO) {
                path.push(otherSibling)
            }
        }
        return path
    }

    async getRootHash() {
        const { hashes } = await this.getContents()
        return hashes[1]
    }
}
MerkleTree.hashLeaf = hashLeaf
MerkleTree.hashCombined = hashCombined

module.exports = MerkleTree
