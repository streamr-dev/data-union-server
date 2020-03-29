const MonoplasmaMember = require("./member")
const { utils: { parseEther, BigNumber: BN }} = require("ethers")

const now = require("./utils/now")
const { throwIfBadAddress } = require("./utils/checkArguments")
const MerkleTree = require("./merkletree")

const log = require("debug")("Streamr::dataunion::MonoplasmaState")

let ID = 0

/**
 * Monoplasma state object
 *
 * Contains the logic of revenue distribution as well as current balances of/and participants
 */
module.exports = class MonoplasmaState {
    /**
     * @param {number} blockFreezeSeconds
     * @param {Array} initialMembers objects: [ { address, earnings }, { address, earnings }, ... ]
     * @param {Object} store offering persistance for blocks
     * @param {string} adminAddress where revenues go if there are no members
     * @param {Object} adminFeeFraction fraction of revenue that goes to admin. Can be expressed as: number between 0 and 1, string of wei, BN of Wei (1 = 10^18)
     * @param {Number} initialBlockNumber after which the state is described by this object
     * @param {Number} initialTimestamp after which the state is described by this object
     */
    constructor({
        blockFreezeSeconds,
        initialMembers,
        store,
        adminAddress,
        adminFeeFraction,
        initialBlockNumber = 0,
        initialTimestamp = 0
    }) {
        this.id = ID++
        this.log = log.extend(this.id)
        throwIfBadAddress(adminAddress, "MonoplasmaState argument adminAddress")
        if (!Array.isArray(initialMembers)) {
            initialMembers = []
        }
        this.log(`Create state with ${initialMembers.length} members.`)
        /** @property {fileStore} store persistence for published blocks */
        this.store = store
        /** @property {number} blockFreezeSeconds after which blocks become withdrawable */
        this.blockFreezeSeconds = blockFreezeSeconds
        /** @property {number} totalEarnings by all members together; should equal balanceOf(contract) + contract.totalWithdrawn */
        this.totalEarnings = initialMembers.reduce((sum, m) => sum.add(m.earnings), new BN(0))

        /** @property {Array<Block>} latestBlocks that have been stored. Kept to figure out  */
        this.latestBlocks = []

        // TODO: consider something like https://www.npmjs.com/package/lru-cache instead; it seems a bit complicated (length function) but could be good for limiting memory use
        /** @property {Array<Object<number, MerkleTree>>} treeCache LRU cache of (blockNumber, cacheHitCount, tree) */
        this.treeCache = []
        this.treeCacheSize = 5  // TODO: make tuneable? Must be at least 2

        /** @property {Number} currentBlock that was last processed. State described by this object is after that block and all its transactions. */
        this.currentBlock = initialBlockNumber
        /** @property {Number} currentTimestamp that was last processed. State described by this object is at or after that time. */
        this.currentTimestamp = initialTimestamp

        /** @property {Array<MonoplasmaMember>} members */
        this.members = initialMembers.map(m => new MonoplasmaMember(m.name, m.address, m.earnings, m.active))
        /** @property {string}  adminAddress the owner address who receives the admin fee and the default payee if no memebers */
        this.adminAddress = adminAddress
        /** @property {BN}  adminFeeFraction fraction of revenue that goes to admin */
        this.setAdminFeeFraction(adminFeeFraction || 0)

        this.indexOf = {}
        this.members.forEach((m, i) => { this.indexOf[m.address] = i })

        const wasNew = this.addMember(adminAddress, "admin")
        const i = this.indexOf[adminAddress]
        this.adminMember = this.members[i]

        // don't enable adminMember to participate into profit-sharing (unless it was also in initialMembers)
        if (wasNew) {
            this.adminMember.setActive(false)
        }
    }

    clone(storeOverride) {
        this.log("Clone state.")
        return new MonoplasmaState({
            blockFreezeSeconds: this.blockFreezeSeconds,
            initialMembers: this.members,
            store: storeOverride || this.store,
            adminAddress: this.adminAddress,
            adminFeeFraction: this.adminFeeFraction,
            initialBlockNumber: this.currentBlock,
            currentTimestamp: this.currentTimestamp
        })
    }

    // ///////////////////////////////////
    //      MEMBER API
    // ///////////////////////////////////

    getMembers() {
        return this.members
            .filter(m => m.isActive())
            .map(m => m.toObject())
    }

    getMemberCount() {
        // "admin member" shouldn't show up in member count unless separately added
        const total = this.members.length - (this.adminMember.isActive() ? 0 : 1)
        const active = this.members.filter(m => m.isActive()).length
        return {
            total,
            active,
            inactive: total - active,
        }
    }

    getTotalRevenue() {
        return this.totalEarnings.toString()
    }

    getLatestBlock() {
        if (this.latestBlocks.length < 1) {
            log("Asked for latest block, nothing to give")
            //log(new Error().stack)
            return null
        }
        const block = this.latestBlocks[0]
        return block
    }

    getLatestWithdrawableBlock() {
        if (this.latestBlocks.length < 1) {
            log("Asked for latest block, nothing to give")
            //log(new Error().stack)
            return null
        }
        const nowTimestamp = now()
        const i = this.latestBlocks.findIndex(b => nowTimestamp - b.timestamp > this.blockFreezeSeconds, this)
        if (i === -1) { return null }         // all blocks still frozen
        this.latestBlocks.length = i + 1    // throw away older than latest withdrawable
        log(`Latest blocks: ${JSON.stringify(this.latestBlocks.map(b => Object.assign({}, b, {members: b.members.length})))}`)
        const block = this.latestBlocks[i]
        return block
    }

    /**
     * Retrieve snapshot written in {this.storeBlock}
     * @param {number} blockNumber
     */
    async getBlock(blockNumber) {
        const cachedBlock = this.latestBlocks.find(b => b.blockNumber === blockNumber)
        if (cachedBlock) {
            return cachedBlock
        }
        // TODO: add LRU cache of old blocks?
        if (!await this.store.blockExists(blockNumber)) { throw new Error(`Block #${blockNumber} not found in published blocks`) }
        const block = await this.store.loadBlock(blockNumber)
        return block
    }

    async listBlockNumbers(maxNumberLatest) {
        return this.store.listBlockNumbers(maxNumberLatest)
    }

    /**
     * Get member's current status (without valid withdrawal proof because it hasn't been recorded)
     * @param {string} address
     */
    async getMember(address) {
        const i = this.indexOf[address]
        if (i === undefined) { return null }
        const m = this.members[i]
        if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: change to return null in production
        const obj = m.toObject()
        obj.active = m.isActive()
        return obj
    }

    /**
     * Get member's info with withdrawal proof at given block
     * @param {string} address
     * @param {number} blockNumber at which (published) block
     */
    async getMemberAt(address, blockNumber) {
        const block = await this.getBlock(blockNumber)
        const member = block.members.find(m => m.address === address)   // TODO: DANGER: O(n^2) potential here! If members were sorted (or indexOF retained), this would be faster
        if (!member) {
            throw new Error(`Member ${address} not found in block ${blockNumber}`)
        }
        member.proof = await this.getProofAt(address, blockNumber)
        return member
    }

    /**
     * Cache recently asked blocks' MerkleTrees
     * NOTE: this function is potentially CPU heavy (lots of members)
     *       Also, it's on "heavy load path" for Monoplasma API server
     *         because members will probably query for their balances often
     *         and proofs are generated at the same (because why not)
     */
    async getTreeAt(blockNumber) {
        if (!blockNumber && blockNumber !== 0) { throw new Error("Must give blockNumber") }
        let cached = this.treeCache.find(c => c.blockNumber === blockNumber)
        if (!cached) {
            // evict the least used if cache is full
            if (this.treeCache.length >= this.treeCacheSize) {
                let minIndex = -1
                let minHits = Number.MAX_SAFE_INTEGER
                this.treeCache.forEach((c, i) => {
                    if (c.hitCount < minHits) {
                        minHits = c.hitCount
                        minIndex = i
                    }
                })
                this.treeCache.splice(minIndex, 1)  // delete 1 item at minIndex
            }

            const block = await this.getBlock(blockNumber)
            const tree = new MerkleTree(block.members, blockNumber)
            cached = {
                blockNumber,
                tree,
                hitCount: 0,
            }
            this.treeCache.push(cached)
        }
        cached.hitCount += 1
        return cached.tree
    }

    /**
     * Get proof of earnings for withdrawal ("payslip") from specific (published) block
     * @param {string} address with earnings to be verified
     * @param {number} blockNumber at which (published) block
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    async getProofAt(address, blockNumber) {
        const block = await this.getBlock(blockNumber)
        const member = block.members.find(m => m.address === address)   // TODO: DANGER: O(n^2) potential here! If members were sorted (or indexOF retained), this would be faster
        if (!member) {
            throw new Error(`Member ${address} not found in block ${blockNumber}`)
        }
        const tree = await this.getTreeAt(blockNumber)
        const path = await tree.getPath(address)
        return path
    }

    async prepareRootHash(blockNumber) {
        const tree = new MerkleTree(this.members, blockNumber)
        return tree.getRootHash()
    }

    async getRootHashAt(blockNumber) {
        if (!this.store.blockExists(blockNumber)) { throw new Error(`Block #${blockNumber} not found in published blocks`) }
        const tree = await this.getTreeAt(blockNumber)
        const rootHash = await tree.getRootHash()
        return rootHash
    }

    // ///////////////////////////////////
    //      ADMIN API
    // ///////////////////////////////////

    /**
     * @param {Number|String|BN} adminFeeFraction fraction of revenue that goes to admin (string should be scaled by 10**18, like ether)
     */
    setAdminFeeFraction(adminFeeFraction) {
        // convert to BN
        if (typeof adminFeeFraction === "number") {
            adminFeeFraction = parseEther(adminFeeFraction.toString())
        } else if (typeof adminFeeFraction === "string" && adminFeeFraction.length > 0) {
            adminFeeFraction = new BN(adminFeeFraction)
        } else if (!adminFeeFraction || adminFeeFraction.constructor !== BN) {
            throw new Error("setAdminFeeFraction: expecting a number, a string, or a bn.js bignumber, got " + JSON.stringify(adminFeeFraction))
        }

        if (adminFeeFraction.lt(0) || adminFeeFraction.gt(parseEther("1"))) {
            throw Error("setAdminFeeFraction: adminFeeFraction must be between 0 and 1")
        }
        this.log(`Setting adminFeeFraction = ${adminFeeFraction}`)
        this.adminFeeFraction = adminFeeFraction
    }

    /**
     * @param {number} amount of tokens that was added to the Community revenues
     */
    addRevenue(amount) {
        const activeMembers = this.members.filter(m => m.isActive())
        const activeCount = activeMembers.length
        if (activeCount === 0) {
            this.log(`No active members in community! Allocating ${amount} to admin account ${this.adminMember.address}`)
            this.adminMember.addRevenue(amount)
        } else {
            const amountBN = new BN(amount)
            const adminFeeBN = amountBN.mul(this.adminFeeFraction).div(parseEther("1"))
            this.log("received tokens amount: " + amountBN + " adminFee: " + adminFeeBN + " fraction * 10^18: " + this.adminFeeFraction)
            const share = amountBN.sub(adminFeeBN).div(activeCount)    // TODO: remainder to admin too, let's not waste them!
            this.adminMember.addRevenue(adminFeeBN)
            activeMembers.forEach(m => m.addRevenue(share))
            this.totalEarnings = this.totalEarnings.add(amountBN)
        }
    }

    /**
     * Add an active recipient into Community, or re-activate existing one (previously removed)
     * @param {string} address of the new member
     * @param {string} name of the new member
     * @returns {boolean} if the added member was new (previously unseen)
     */
    addMember(address, name) {
        const i = this.indexOf[address]
        const isNewAddress = i === undefined
        if (isNewAddress) {
            const m = new MonoplasmaMember(name, address)
            this.members = this.members.concat(m)
            this.indexOf[address] = this.members.length - 1
        } else {
            const m = this.members[i]
            if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: remove in production; this means updating indexOf has been botched
            m.setActive(true)
        }
        this.log("addMember", {
            i,
            address,
            name,
            isNewAddress,
        })
        // tree.update(members)     // no need for update since no revenue allocated
        return isNewAddress
    }

    /**
     * De-activate a member, it will not receive revenues until re-activated
     * @param {string} address
     * @returns {boolean} if the de-activated member was previously active (and existing)
     */
    removeMember(address) {
        let wasActive = false
        const i = this.indexOf[address]
        if (i !== undefined) {
            let m = this.members[i]
            if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: remove in production; this means updating indexOf has been botched
            m = m.clone()
            wasActive = m.isActive()
            m.setActive(false)
            this.members = this.members.slice()
            this.members[i] = m
        }
        this.log("removeMember", {
            i,
            address,
            wasActive,
        })
        // tree.update(members)     // no need for update since no revenue allocated
        return wasActive
    }

    /**
     * Monoplasma member to be added
     * @typedef {Object<string, string>} IncomingMember
     * @property {string} address Ethereum address of the Community member
     * @property {string} name Human-readable string representation
     */
    /**
     * Add active recipients into Community, or re-activate existing ones (previously removed)
     * @param {Array<IncomingMember|string>} members
     * @returns {Array<IncomingMember|string>} members that were actually added
     */
    addMembers(members) {
        this.log("addMembers", members.length)
        const added = []
        members.forEach(member => {
            const m = typeof member === "string" ? { address: member } : member
            const wasNew = this.addMember(m.address, m.name)
            if (wasNew) { added.push(member) }
        })
        return added
    }

    /**
     * De-activate members: they will not receive revenues until re-activated
     * @param {Array<string>} addresses
     * @returns {Array<string>} addresses of members that were actually removed
     */
    removeMembers(addresses) {
        this.log("removeMembers", addresses.length)
        const removed = []
        addresses.forEach(address => {
            const wasActive = this.removeMember(address)
            if (wasActive) { removed.push(address) }
        })
        return removed
    }

    /**
     * Snapshot the Monoplasma state for later use (getMemberAt, getProofAt)
     * @param {number} blockNumber root-chain block number after which this block state is valid
     * @param {number} timestamp in seconds of NewCommit event
     */
    async storeBlock(blockNumber, timestamp) {
        if (!Number.isSafeInteger(timestamp)) { throw new Error("Timestamp should be a positive Number, got: " + timestamp) }
        if (!Number.isSafeInteger(blockNumber) || !(blockNumber > 0)) { throw new Error("blockNumber must be a positive integer")}
        const newerBlock = this.latestBlocks.find((block) => block.blockNumber >= blockNumber)
        if (newerBlock) {
            throw new Error(`Already stored same or newer block. Found: ${newerBlock.blockNumber} Storing: ${blockNumber}.`)
        }
        this.log(`Storing block ${blockNumber} at timestamp ${timestamp}`)
        const latestBlock = {
            blockNumber,
            members: this.members.map(m => m.toObject()),
            timestamp,
            storeTimestamp: now(),
            totalEarnings: this.getTotalRevenue(),
            owner: this.adminAddress,
            adminFeeFractionWeiString: this.adminFeeFraction.toString(),
        }
        this.latestBlocks.unshift(latestBlock) // = insert to beginning
        this.latestBlocks.sort((a, b) => b.blockNumber - a.blockNumber)
        log(`Latest blocks: ${JSON.stringify(this.latestBlocks.map(b => Object.assign({}, b, {members: b.members.length})))}`)
        await this.store.saveBlock(latestBlock)
        return latestBlock
    }

    /**
     * Return a read-only "member API" that can only query this object
     */
    getMemberApi() {
        return {
            getMembers: this.getMembers.bind(this),
            getMember: this.getMember.bind(this),
            getMemberCount: this.getMemberCount.bind(this),
            getTotalRevenue: this.getTotalRevenue.bind(this),
            getProofAt: this.getProofAt.bind(this),
            getRootHashAt: this.getRootHashAt.bind(this),
            getBlock: this.getBlock.bind(this),
            getLatestBlock: this.getLatestBlock.bind(this),
            getLatestWithdrawableBlock: this.getLatestWithdrawableBlock.bind(this),
            listBlockNumbers: this.listBlockNumbers.bind(this),
        }
    }
}
