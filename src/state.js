"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var member_1 = require("./member");
var _a = require("ethers").utils, parseEther = _a.parseEther, BN = _a.BigNumber;
var now = require("./utils/now");
var throwIfBadAddress = require("./utils/checkArguments").throwIfBadAddress;
var MerkleTree = require("./merkletree");
var log = require("debug")("Streamr::dataunion::MonoplasmaState");
var ID = 0;
/**
 * Monoplasma state object
 *
 * Contains the logic of revenue distribution as well as current balances of/and participants
 */
var MonoplasmaState = /** @class */ (function () {
    /**
     * @param {number} blockFreezeSeconds
     * @param {Array} initialMembers objects: [ { address, earnings }, { address, earnings }, ... ]
     * @param {Object} store offering persistance for blocks
     * @param {string} adminAddress where revenues go if there are no members
     * @param {Object} adminFeeFraction fraction of revenue that goes to admin. Can be expressed as: number between 0 and 1, string of wei, BN of Wei (1 = 10^18)
     * @param {Number} initialBlockNumber after which the state is described by this object
     * @param {Number} initialTimestamp after which the state is described by this object
     */
    function MonoplasmaState(blockFreezeSeconds, initialMembers, store, adminAddress, adminFeeFraction, initialBlockNumber, initialTimestamp) {
        var _this = this;
        if (initialBlockNumber === void 0) { initialBlockNumber = 0; }
        if (initialTimestamp === void 0) { initialTimestamp = 0; }
        this.id = ID++;
        this.log = log.extend(this.id);
        throwIfBadAddress(adminAddress, "MonoplasmaState argument adminAddress");
        if (!Array.isArray(initialMembers)) {
            initialMembers = [];
        }
        this.log("Create state with " + initialMembers.length + " members.");
        /** @property {Store} store persistence for published blocks */
        this.store = store;
        /** @property {number} blockFreezeSeconds after which blocks become withdrawable */
        this.blockFreezeSeconds = blockFreezeSeconds;
        /** @property {number} totalEarnings by all members together; should equal balanceOf(contract) + contract.totalWithdrawn */
        this.totalEarnings = initialMembers.reduce(function (sum, m) { return sum.add(m.earnings); }, new BN(0));
        /** @property {Array<Block>} latestBlocks that have been stored. Kept to figure out  */
        //this.latestBlocks = []
        // TODO: consider something like https://www.npmjs.com/package/lru-cache instead; it seems a bit complicated (length function) but could be good for limiting memory use
        /** @property {Array<Object<number, MerkleTree>>} treeCache LRU cache of (blockNumber, cacheHitCount, tree) */
        this.treeCache = [];
        this.treeCacheSize = 5; // TODO: make tuneable? Must be at least 2
        /** @property {Number} currentBlock that was last processed. State described by this object is after that block and all its transactions. */
        this.currentBlock = initialBlockNumber;
        /** @property {Number} currentTimestamp that was last processed. State described by this object is at or after that time. */
        this.currentTimestamp = initialTimestamp;
        /** @property {Array<MonoplasmaMember>} members */
        this.members = initialMembers.map(function (m) { return new member_1.MonoplasmaMember(m.name, m.address, m.earnings, m.active); });
        /** @property {string}  adminAddress the owner address who receives the admin fee and the default payee if no memebers */
        this.adminAddress = adminAddress;
        /** @property {BN}  adminFeeFraction fraction of revenue that goes to admin */
        this.setAdminFeeFraction(adminFeeFraction || 0);
        this.indexOf = {};
        this.members.forEach(function (m, i) { _this.indexOf[m.address] = i; });
        var wasNew = this.addMember(adminAddress, "admin");
        var i = this.indexOf[adminAddress];
        this.adminMember = this.members[i];
        // don't enable adminMember to participate into profit-sharing (unless it was also in initialMembers)
        if (wasNew) {
            this.adminMember.setActive(false);
        }
    }
    MonoplasmaState.prototype.clone = function (storeOverride) {
        this.log("Clone state.");
        return new MonoplasmaState({
            blockFreezeSeconds: this.blockFreezeSeconds,
            initialMembers: this.members,
            store: storeOverride || this.store,
            adminAddress: this.adminAddress,
            adminFeeFraction: this.adminFeeFraction,
            initialBlockNumber: this.currentBlock,
            currentTimestamp: this.currentTimestamp
        });
    };
    // ///////////////////////////////////
    //      MEMBER API
    // ///////////////////////////////////
    MonoplasmaState.prototype.getMembers = function () {
        return this.members
            .filter(function (m) { return m.isActive(); })
            .map(function (m) { return m.toObject(); });
    };
    MonoplasmaState.prototype.getMemberCount = function () {
        // "admin member" shouldn't show up in member count unless separately added
        var total = this.members.length - (this.adminMember.isActive() ? 0 : 1);
        var active = this.members.filter(function (m) { return m.isActive(); }).length;
        return {
            total: total,
            active: active,
            inactive: total - active,
        };
    };
    MonoplasmaState.prototype.getTotalRevenue = function () {
        return this.totalEarnings.toString();
    };
    MonoplasmaState.prototype.getLatestBlock = function () {
        /*
                if (this.latestBlocks.length < 1) {
                    log("Asked for latest block, nothing to give")
                    //log(new Error().stack)
                    return null
                }
                const block = this.latestBlocks[0]
        */
        return this.store.getLatestBlock();
    };
    MonoplasmaState.prototype.getLatestWithdrawableBlock = function () {
        var _this = this;
        if (this.store.hasLatestBlock()) {
            log("Asked for latest block, nothing to give");
            //log(new Error().stack)
            return null;
        }
        var nowTimestamp = now();
        var i = this.latestBlocks.findIndex(function (b) { return nowTimestamp - b.timestamp > _this.blockFreezeSeconds; }, this);
        if (i === -1) {
            return null;
        } // all blocks still frozen
        this.latestBlocks.length = i + 1; // throw away older than latest withdrawable
        log("Latest blocks: " + JSON.stringify(this.latestBlocks.map(function (b) { return Object.assign({}, b, { members: b.members.length }); })));
        var block = this.latestBlocks[i];
        return block;
    };
    /**
     * Retrieve snapshot written in {this.storeBlock}
     * @param {number} blockNumber
     */
    MonoplasmaState.prototype.getBlock = function (blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var cachedBlock, block;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cachedBlock = this.latestBlocks.find(function (b) { return b.blockNumber === blockNumber; });
                        if (cachedBlock) {
                            return [2 /*return*/, cachedBlock];
                        }
                        return [4 /*yield*/, this.store.blockExists(blockNumber)];
                    case 1:
                        // TODO: add LRU cache of old blocks?
                        if (!(_a.sent())) {
                            throw new Error("Block #" + blockNumber + " not found in published blocks");
                        }
                        return [4 /*yield*/, this.store.loadBlock(blockNumber)];
                    case 2:
                        block = _a.sent();
                        return [2 /*return*/, block];
                }
            });
        });
    };
    MonoplasmaState.prototype.listBlockNumbers = function (maxNumberLatest) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.store.listBlockNumbers(maxNumberLatest)];
            });
        });
    };
    /**
     * Get member's current status (without valid withdrawal proof because it hasn't been recorded)
     * @param {string} address
     */
    MonoplasmaState.prototype.getMember = function (address) {
        return __awaiter(this, void 0, void 0, function () {
            var i, m, obj;
            return __generator(this, function (_a) {
                i = this.indexOf[address];
                if (i === undefined) {
                    return [2 /*return*/, null];
                }
                m = this.members[i];
                if (!m) {
                    throw new Error("Bad index " + i);
                } // TODO: change to return null in production
                obj = m.toObject();
                obj.active = m.isActive();
                return [2 /*return*/, obj];
            });
        });
    };
    /**
     * Get member's info with withdrawal proof at given block
     * @param {string} address
     * @param {number} blockNumber at which (published) block
     */
    MonoplasmaState.prototype.getMemberAt = function (address, blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var block, member, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.getBlock(blockNumber)];
                    case 1:
                        block = _b.sent();
                        member = block.members.find(function (m) { return m.address === address; }) // TODO: DANGER: O(n^2) potential here! If members were sorted (or indexOF retained), this would be faster
                        ;
                        if (!member) {
                            throw new Error("Member " + address + " not found in block " + blockNumber);
                        }
                        _a = member;
                        return [4 /*yield*/, this.getProofAt(address, blockNumber)];
                    case 2:
                        _a.proof = _b.sent();
                        return [2 /*return*/, member];
                }
            });
        });
    };
    /**
     * Cache recently asked blocks' MerkleTrees
     * NOTE: this function is potentially CPU heavy (lots of members)
     *       Also, it's on "heavy load path" for Monoplasma API server
     *         because members will probably query for their balances often
     *         and proofs are generated at the same (because why not)
     */
    MonoplasmaState.prototype.getTreeAt = function (blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var cached, minIndex_1, minHits_1, block, tree;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!blockNumber && blockNumber !== 0) {
                            throw new Error("Must give blockNumber");
                        }
                        cached = this.treeCache.find(function (c) { return c.blockNumber === blockNumber; });
                        if (!!cached) return [3 /*break*/, 2];
                        // evict the least used if cache is full
                        if (this.treeCache.length >= this.treeCacheSize) {
                            minIndex_1 = -1;
                            minHits_1 = Number.MAX_SAFE_INTEGER;
                            this.treeCache.forEach(function (c, i) {
                                if (c.hitCount < minHits_1) {
                                    minHits_1 = c.hitCount;
                                    minIndex_1 = i;
                                }
                            });
                            this.treeCache.splice(minIndex_1, 1); // delete 1 item at minIndex
                        }
                        return [4 /*yield*/, this.getBlock(blockNumber)];
                    case 1:
                        block = _a.sent();
                        tree = new MerkleTree(block.members, blockNumber);
                        cached = {
                            blockNumber: blockNumber,
                            tree: tree,
                            hitCount: 0,
                        };
                        this.treeCache.push(cached);
                        _a.label = 2;
                    case 2:
                        cached.hitCount += 1;
                        return [2 /*return*/, cached.tree];
                }
            });
        });
    };
    /**
     * Get proof of earnings for withdrawal ("payslip") from specific (published) block
     * @param {string} address with earnings to be verified
     * @param {number} blockNumber at which (published) block
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    MonoplasmaState.prototype.getProofAt = function (address, blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var block, member, tree, path;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getBlock(blockNumber)];
                    case 1:
                        block = _a.sent();
                        member = block.members.find(function (m) { return m.address === address; }) // TODO: DANGER: O(n^2) potential here! If members were sorted (or indexOF retained), this would be faster
                        ;
                        if (!member) {
                            throw new Error("Member " + address + " not found in block " + blockNumber);
                        }
                        return [4 /*yield*/, this.getTreeAt(blockNumber)];
                    case 2:
                        tree = _a.sent();
                        return [4 /*yield*/, tree.getPath(address)];
                    case 3:
                        path = _a.sent();
                        return [2 /*return*/, path];
                }
            });
        });
    };
    MonoplasmaState.prototype.prepareRootHash = function (blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var tree;
            return __generator(this, function (_a) {
                tree = new MerkleTree(this.members, blockNumber);
                return [2 /*return*/, tree.getRootHash()];
            });
        });
    };
    MonoplasmaState.prototype.getRootHashAt = function (blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var tree, rootHash;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.store.blockExists(blockNumber)) {
                            throw new Error("Block #" + blockNumber + " not found in published blocks");
                        }
                        return [4 /*yield*/, this.getTreeAt(blockNumber)];
                    case 1:
                        tree = _a.sent();
                        return [4 /*yield*/, tree.getRootHash()];
                    case 2:
                        rootHash = _a.sent();
                        return [2 /*return*/, rootHash];
                }
            });
        });
    };
    // ///////////////////////////////////
    //      ADMIN API
    // ///////////////////////////////////
    /**
     * @param {Number|String|BN} adminFeeFraction fraction of revenue that goes to admin (string should be scaled by 10**18, like ether)
     */
    MonoplasmaState.prototype.setAdminFeeFraction = function (adminFeeFraction) {
        // convert to BN
        if (typeof adminFeeFraction === "number") {
            adminFeeFraction = parseEther(adminFeeFraction.toString());
        }
        else if (typeof adminFeeFraction === "string" && adminFeeFraction.length > 0) {
            adminFeeFraction = new BN(adminFeeFraction);
        }
        else if (!adminFeeFraction || adminFeeFraction.constructor !== BN) {
            throw new Error("setAdminFeeFraction: expecting a number, a string, or a bn.js bignumber, got " + JSON.stringify(adminFeeFraction));
        }
        if (adminFeeFraction.lt(0) || adminFeeFraction.gt(parseEther("1"))) {
            throw Error("setAdminFeeFraction: adminFeeFraction must be between 0 and 1");
        }
        this.log("Setting adminFeeFraction = " + adminFeeFraction);
        this.adminFeeFraction = adminFeeFraction;
    };
    /**
     * @param {number} amount of tokens that was added to the data union revenues
     */
    MonoplasmaState.prototype.addRevenue = function (amount) {
        var activeMembers = this.members.filter(function (m) { return m.isActive(); });
        var activeCount = activeMembers.length;
        if (activeCount === 0) {
            this.log("No active members in data union! Allocating " + amount + " to admin account " + this.adminMember.address);
            this.adminMember.addRevenue(amount);
        }
        else {
            var amountBN = new BN(amount);
            var adminFeeBN = amountBN.mul(this.adminFeeFraction).div(parseEther("1"));
            this.log("received tokens amount: " + amountBN + " adminFee: " + adminFeeBN + " fraction * 10^18: " + this.adminFeeFraction);
            var share_1 = amountBN.sub(adminFeeBN).div(activeCount); // TODO: remainder to admin too, let's not waste them!
            this.adminMember.addRevenue(adminFeeBN);
            activeMembers.forEach(function (m) { return m.addRevenue(share_1); });
            this.totalEarnings = this.totalEarnings.add(amountBN);
        }
    };
    /**
     * Add an active recipient into data union, or re-activate existing one (previously removed)
     * @param {string} address of the new member
     * @param {string} name of the new member
     * @returns {boolean} if the added member was new (previously unseen)
     */
    MonoplasmaState.prototype.addMember = function (address, name) {
        var i = this.indexOf[address];
        var isNewAddress = i === undefined;
        if (isNewAddress) {
            var m = new member_1.MonoplasmaMember(name, address);
            this.members = this.members.concat(m);
            this.indexOf[address] = this.members.length - 1;
        }
        else {
            var m = this.members[i];
            if (!m) {
                throw new Error("Bad index " + i);
            } // TODO: remove in production; this means updating indexOf has been botched
            m.setActive(true);
        }
        this.log("addMember", {
            i: i,
            address: address,
            name: name,
            isNewAddress: isNewAddress,
        });
        // tree.update(members)     // no need for update since no revenue allocated
        return isNewAddress;
    };
    /**
     * De-activate a member, it will not receive revenues until re-activated
     * @param {string} address
     * @returns {boolean} if the de-activated member was previously active (and existing)
     */
    MonoplasmaState.prototype.removeMember = function (address) {
        var wasActive = false;
        var i = this.indexOf[address];
        if (i !== undefined) {
            var m = this.members[i];
            if (!m) {
                throw new Error("Bad index " + i);
            } // TODO: remove in production; this means updating indexOf has been botched
            m = m.clone();
            wasActive = m.isActive();
            m.setActive(false);
            this.members = this.members.slice();
            this.members[i] = m;
        }
        this.log("removeMember", {
            i: i,
            address: address,
            wasActive: wasActive,
        });
        // tree.update(members)     // no need for update since no revenue allocated
        return wasActive;
    };
    /**
     * Monoplasma member to be added
     * @typedef {Object<string, string>} IncomingMember
     * @property {string} address Ethereum address of the data union member
     * @property {string} name Human-readable string representation
     */
    /**
     * Add active recipients into data union, or re-activate existing ones (previously removed)
     * @param {Array<IncomingMember|string>} members
     * @returns {Array<IncomingMember|string>} members that were actually added
     */
    MonoplasmaState.prototype.addMembers = function (members) {
        var _this = this;
        this.log("addMembers", members.length);
        var added = [];
        members.forEach(function (member) {
            var m = typeof member === "string" ? { address: member } : member;
            var wasNew = _this.addMember(m.address, m.name);
            if (wasNew) {
                added.push(member);
            }
        });
        return added;
    };
    /**
     * De-activate members: they will not receive revenues until re-activated
     * @param {Array<string>} addresses
     * @returns {Array<string>} addresses of members that were actually removed
     */
    MonoplasmaState.prototype.removeMembers = function (addresses) {
        var _this = this;
        this.log("removeMembers", addresses.length);
        var removed = [];
        addresses.forEach(function (address) {
            var wasActive = _this.removeMember(address);
            if (wasActive) {
                removed.push(address);
            }
        });
        return removed;
    };
    /**
     * Snapshot the Monoplasma state for later use (getMemberAt, getProofAt)
     * @param {number} blockNumber root-chain block number after which this block state is valid
     * @param {number} timestamp in seconds of NewCommit event
     */
    MonoplasmaState.prototype.storeBlock = function (blockNumber, timestamp) {
        return __awaiter(this, void 0, void 0, function () {
            var newerBlock, latestBlock;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!Number.isSafeInteger(timestamp)) {
                            throw new Error("Timestamp should be a positive Number, got: " + timestamp);
                        }
                        if (!Number.isSafeInteger(blockNumber) || !(blockNumber > 0)) {
                            throw new Error("blockNumber must be a positive integer");
                        }
                        newerBlock = this.latestBlocks.find(function (block) { return block.blockNumber >= blockNumber; });
                        if (newerBlock) {
                            throw new Error("Already stored same or newer block. Found: " + newerBlock.blockNumber + " Storing: " + blockNumber + ".");
                        }
                        this.log("Storing block " + blockNumber + " at timestamp " + timestamp);
                        latestBlock = {
                            blockNumber: blockNumber,
                            members: this.members.map(function (m) { return m.toObject(); }),
                            timestamp: timestamp,
                            storeTimestamp: now(),
                            totalEarnings: this.getTotalRevenue(),
                            owner: this.adminAddress,
                            adminFeeFractionWeiString: this.adminFeeFraction.toString(),
                        };
                        this.latestBlocks.unshift(latestBlock); // = insert to beginning
                        this.latestBlocks.sort(function (a, b) { return b.blockNumber - a.blockNumber; });
                        log("Latest blocks: " + JSON.stringify(this.latestBlocks.map(function (b) { return Object.assign({}, b, { members: b.members.length }); })));
                        return [4 /*yield*/, this.store.saveBlock(latestBlock)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, latestBlock];
                }
            });
        });
    };
    /**
     * Return a read-only "member API" that can only query this object
     */
    MonoplasmaState.prototype.getMemberApi = function () {
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
        };
    };
    return MonoplasmaState;
}());
//# sourceMappingURL=state.js.map