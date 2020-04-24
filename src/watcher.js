"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
var EventEmitter = require("events");
//const { Contract, utils } = require("ethers")
var ethers_1 = require("ethers");
var MonoplasmaState = require("./state");
var _a = require("./utils/events"), replayOn = _a.replayOn, mergeEventLists = _a.mergeEventLists;
var _b = require("./utils/checkArguments"), throwIfSetButNotContract = _b.throwIfSetButNotContract, throwIfSetButBadAddress = _b.throwIfSetButBadAddress;
var bisectFindFirstIndex = require("./utils/bisectFindFirstIndex");
var TokenContract = require("../build/ERC20Mintable.json");
var MonoplasmaJson = require("../build/Monoplasma.json");
var log = require("debug")("Streamr::dataunion::watcher");
// TODO: this typedef is foobar. How to get the real thing with JSDoc?
/** @typedef {number} BigNumber */
/**
 * Rewrote ethers.js parseLog mainly because of naming incompatibilities (also use of "this"... hrrr...)
 * This one pulls an ugly one and mutates incoming logs (adds "event" and "args")
 * It's here only until ethers.js v5 is out: "if you use v5, you can use contract.queryFilter, which will include the parsed events" https://github.com/ethers-io/ethers.js/issues/37
 *
 * @see https://github.com/ethers-io/ethers.js/blob/master/utils/interface.js#L357
 * @param {utils.Interface} interface from ethers Contract.interface
 * @param {Array<utils.LogDescription>} logs from Provider.getLogs
 */
function parseLogs(interface, logs) {
    for (var _i = 0, logs_1 = logs; _i < logs_1.length; _i++) {
        var log_1 = logs_1[_i];
        for (var type in interface.events) {
            var event_1 = interface.events[type];
            if (event_1.topic === log_1.topics[0]) {
                log_1.event = event_1.name;
                log_1.args = event_1.decode(log_1.data, log_1.topics);
            }
        }
    }
}
/**
 * MonoplasmaWatcher hooks to the Ethereum root chain contract and Streamr join/part stream
 * It syncs the state from Ethereum and Streamr into the store
 */
module.exports = /** @class */ (function (_super) {
    __extends(MonoplasmaWatcher, _super);
    function MonoplasmaWatcher(eth, joinPartChannel, store) {
        var _this = _super.call(this) || this;
        _this.eth = eth;
        _this.channel = joinPartChannel;
        _this.store = store;
        // TODO: move messageCache to streamrChannel? I.e. require playback of old messages.
        _this.messageCache = [];
        _this.cachePrunedUpTo = 0; // TODO: this is here mostly for debug / error catching purposes
        _this.filters = {};
        _this.eventLogIndex = +new Date();
        _this.blockTimestampCache = {};
        return _this;
    }
    /**
     * Sync the state into store, start listening to events and messages
     * @param {MonoplasmaConfig} config
     * @returns {Promise} resolves when MonoplasmaState is synced and listeners added
     */
    MonoplasmaWatcher.prototype.start = function (config) {
        return __awaiter(this, void 0, void 0, function () {
            var network, savedState, _a, _b, _c, _d, lastBlock, playbackStartingTimestampMs, _e, _f, currentBlock, _g;
            var _this = this;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0: return [4 /*yield*/, throwIfSetButNotContract(this.eth, config.contractAddress, "contractAddress from initial config")];
                    case 1:
                        _h.sent();
                        this.log = log.extend(config.contractAddress);
                        // TODO: this isn't even used; maybe should throw if it's different from what contract gives?
                        throwIfSetButBadAddress(config.adminAddress, "adminAddress from initial config");
                        return [4 /*yield*/, this.eth.getNetwork()];
                    case 2:
                        network = _h.sent();
                        this.log("Connected to Ethereum network: " + JSON.stringify(network));
                        if (network.chainId === 1) {
                            this.blockTimestampCache = require("../mainnet_timestamp_cache.json");
                            this.log("Loaded " + Object.keys(this.blockTimestampCache).length + " block timestamps from disk");
                        }
                        // this.state should be broken up into state.js, and rest called this.config
                        this.log("Initializing Monoplasma state...");
                        if (!config.reset) return [3 /*break*/, 3];
                        _a = {};
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, this.store.loadState()];
                    case 4:
                        _a = _h.sent();
                        _h.label = 5;
                    case 5:
                        savedState = _a;
                        this.state = Object.assign({
                            adminFee: 0,
                        }, savedState, config);
                        this.eth.on("block", function (blockNumber) {
                            if (blockNumber % 10 === 0) {
                                _this.log("Block " + blockNumber + " observed");
                            }
                            _this.state.lastObservedBlockNumber = blockNumber;
                        });
                        // get initial state from contracts, also works as a sanity check for the config
                        this.contract = new ethers_1.Contract(this.state.contractAddress, MonoplasmaJson.abi, this.eth);
                        _b = this.state;
                        return [4 /*yield*/, this.contract.token()];
                    case 6:
                        _b.tokenAddress = _h.sent();
                        _c = this.state;
                        return [4 /*yield*/, this.contract.owner()];
                    case 7:
                        _c.adminAddress = _h.sent();
                        this.token = new ethers_1.Contract(this.state.tokenAddress, TokenContract.abi, this.eth);
                        _d = this.state;
                        return [4 /*yield*/, this.contract.blockFreezeSeconds()];
                    case 8:
                        _d.blockFreezeSeconds = (_h.sent()).toString();
                        this.log("Read from contracts: freeze period = " + this.state.blockFreezeSeconds + " sec, token @ " + this.state.tokenAddress);
                        // TODO: next time a new event is added, DRY this (there's like 6 repetitions of listened events)
                        this.adminFeeFilter = this.contract.filters.AdminFeeChanged();
                        this.blockCreateFilter = this.contract.filters.NewCommit();
                        this.tokenTransferFilter = this.token.filters.Transfer(null, this.contract.address);
                        lastBlock = {
                            members: [],
                            blockNumber: 0,
                            timestamp: 0,
                        };
                        return [4 /*yield*/, this.store.hasLatestBlock()];
                    case 9:
                        if (!_h.sent()) return [3 /*break*/, 11];
                        this.log("Getting latest block from store");
                        return [4 /*yield*/, this.store.getLatestBlock()];
                    case 10:
                        lastBlock = _h.sent();
                        this.log("Got " + JSON.stringify(lastBlock));
                        _h.label = 11;
                    case 11:
                        this.log("Syncing Monoplasma state starting from block " + lastBlock.blockNumber + " (t=" + lastBlock.timestamp + ") with " + lastBlock.members.length + " members");
                        _e = lastBlock.timestamp;
                        if (_e) return [3 /*break*/, 14];
                        _f = lastBlock.blockNumber;
                        if (!_f) return [3 /*break*/, 13];
                        return [4 /*yield*/, this.getBlockTimestamp(lastBlock.blockNumber)];
                    case 12:
                        _f = (_h.sent());
                        _h.label = 13;
                    case 13:
                        _e = _f;
                        _h.label = 14;
                    case 14:
                        playbackStartingTimestampMs = _e || 0;
                        this.plasma = new MonoplasmaState({
                            blockFreezeSeconds: this.state.blockFreezeSeconds,
                            initialMembers: lastBlock.members,
                            store: this.store,
                            adminAddress: this.state.adminAddress,
                            adminFeeFraction: this.state.adminFee,
                            initialBlockNumber: lastBlock.blockNumber,
                            initialTimestamp: playbackStartingTimestampMs / 1000,
                        });
                        this.log("Getting joins/parts from the Channel starting from t=" + playbackStartingTimestampMs + ", " + new Date(playbackStartingTimestampMs).toISOString());
                        // replay and cache messages until in sync
                        // TODO: cache only starting from given block (that operator/validator have loaded state from store)
                        this.channel.on("message", function (type, addresses, meta) {
                            _this.log("Message received: " + type + " " + addresses);
                            var addressList = addresses.map(ethers_1.utils.getAddress);
                            var event = { type: type, addressList: addressList, timestamp: meta.messageId.timestamp };
                            _this.messageCache.push(event);
                        });
                        return [4 /*yield*/, this.channel.listen(playbackStartingTimestampMs)];
                    case 15:
                        _h.sent();
                        this.log("Playing back " + this.messageCache.length + " messages from joinPartStream");
                        // messages are now cached => do the Ethereum event playback, sync up this.plasma
                        this.channel.on("error", this.log);
                        return [4 /*yield*/, this.eth.getBlockNumber()];
                    case 16:
                        currentBlock = _h.sent();
                        _g = this.state;
                        return [4 /*yield*/, this.playbackUntilBlock(currentBlock, this.plasma)
                            // for messages from now on: add to cache but also replay directly to "realtime plasma"
                        ];
                    case 17:
                        _g.lastPublishedBlock = _h.sent();
                        // for messages from now on: add to cache but also replay directly to "realtime plasma"
                        this.channel.on("message", function (type, addresses, meta) { return __awaiter(_this, void 0, void 0, function () {
                            var addressList, event;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        addressList = addresses.map(ethers_1.utils.getAddress);
                                        event = { type: type, addressList: addressList, timestamp: meta.messageId.timestamp };
                                        this.log("Members " + type + ": " + addressList);
                                        return [4 /*yield*/, replayOn(this.plasma, [event])];
                                    case 1:
                                        _a.sent();
                                        this.emit(type, addresses);
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.log("Listening to Ethereum events...");
                        this.contract.on(this.adminFeeFilter, function (adminFee, event) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        this.log("Admin fee changed to " + ethers_1.utils.formatEther(adminFee) + " at block " + event.blockNumber);
                                        _a = event;
                                        return [4 /*yield*/, this.getBlockTimestamp(event.blockNumber)];
                                    case 1:
                                        _a.timestamp = _b.sent();
                                        return [4 /*yield*/, replayOn(this.plasma, [event])];
                                    case 2:
                                        _b.sent();
                                        this.emit("adminFeeChanged", event);
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.contract.on(this.blockCreateFilter, function (blockNumber, rootHash, ipfsHash, event) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        this.log("Observed creation of block " + +blockNumber + " at block " + event.blockNumber + " (root " + rootHash + ", ipfs \"" + ipfsHash + "\")");
                                        _a = event;
                                        return [4 /*yield*/, this.getBlockTimestamp(event.blockNumber)
                                            //this.state.lastPublishedBlock = event.args
                                        ];
                                    case 1:
                                        _a.timestamp = _b.sent();
                                        //this.state.lastPublishedBlock = event.args
                                        this.emit("blockCreated", event);
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        this.token.on(this.tokenTransferFilter, function (to, from, amount, event) { return __awaiter(_this, void 0, void 0, function () {
                            var _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        this.log("Received " + ethers_1.utils.formatEther(event.args.value) + " DATA");
                                        _a = event;
                                        return [4 /*yield*/, this.getBlockTimestamp(event.blockNumber)];
                                    case 1:
                                        _a.timestamp = _b.sent();
                                        return [4 /*yield*/, replayOn(this.plasma, [event])];
                                    case 2:
                                        _b.sent();
                                        this.emit("tokensReceived", event);
                                        return [2 /*return*/];
                                }
                            });
                        }); });
                        /*
                        // TODO: ethers.js re-org handling
                        this.tokenFilter.on("changed", event => {
                            const i = this.eventQueue.findIndex(e => e.blockNumber === event.blockNumber && e.transactionIndex === event.transactionIndex)
                            if (i > -1) {
                                this.log(`Chain re-organization, event removed: ${JSON.stringify(event)}`)
                                this.eventQueue.splice(i, 1)
                            } else {
                                // TODO: how to handle? This might invalidate old commits or mess the state,
                                //   perhaps need to resync the whole thing (restart with config.reset=true),
                                this.error(`Event removed in reorg, but not found in eventQueue: ${JSON.stringify(event)}`)
                            }
                        })
                        this.tokenFilter.on("error", this.error)
                        */
                        this.eth.on("block", function (blockNumber) {
                            if (blockNumber % 10 === 0) {
                                _this.log("Block " + blockNumber + " observed");
                            }
                            _this.state.lastObservedBlockNumber = blockNumber;
                        });
                        // TODO: maybe state saving function should create the state object instead of continuously mutating "state" member
                        return [4 /*yield*/, this.saveState()];
                    case 18:
                        // TODO: maybe state saving function should create the state object instead of continuously mutating "state" member
                        _h.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    MonoplasmaWatcher.prototype.saveState = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.store.saveState(this.state)];
            });
        });
    };
    MonoplasmaWatcher.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: 
                    //this.tokenFilter.unsubscribe()
                    return [4 /*yield*/, this.channel.close()];
                    case 1:
                        //this.tokenFilter.unsubscribe()
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Clone given state and overwrite current MonoplasmaState of the watcher
     * @param {MonoplasmaState} monoplasmaState original to be copied
     */
    MonoplasmaWatcher.prototype.setState = function (monoplasmaState) {
        this.plasma = new MonoplasmaState({
            blockFreezeSeconds: this.state.blockFreezeSeconds,
            initialMembers: monoplasmaState.members,
            store: this.store,
            adminAddress: this.state.adminAddress,
            adminFeeFraction: this.state.adminFee,
            initialBlockNumber: monoplasmaState.blockNumber,
            initialTimestamp: monoplasmaState.timestamp,
        });
    };
    /**
     * Advance the "committed" or "final" state which reflects the blocks committed by the operator
     * @param {Number} toBlock is blockNumber from BlockCreated event
     * @param {MonoplasmaState} plasma to sync, default is this watcher's "realtime state"
     */
    MonoplasmaWatcher.prototype.playbackUntilBlock = function (toBlock, plasma) {
        return __awaiter(this, void 0, void 0, function () {
            var fromBlock, fromTimestamp, toTimestamp, adminFeeFilter, blockCreateFilter, tokenTransferFilter, adminFeeEvents, blockCreateEvents, transferEvents, events, _i, events_1, event_2, _a, fromIndex, toIndex, messages, lastPublishedBlock;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!plasma) {
                            plasma = this.plasma;
                        }
                        fromBlock = plasma.currentBlock + 1 || 0 // JSON RPC filters are inclusive, hence +1
                        ;
                        if (toBlock <= fromBlock) {
                            this.log("Playback skipped: block " + toBlock + " requested, already at " + fromBlock);
                            return [2 /*return*/];
                        }
                        fromTimestamp = plasma.currentTimestamp || 0;
                        return [4 /*yield*/, this.getBlockTimestamp(toBlock)];
                    case 1:
                        toTimestamp = _b.sent();
                        if (fromTimestamp < this.cachePrunedUpTo) {
                            throw new Error("Cache has been pruned up to " + this.cachePrunedUpTo + ", can't play back correctly " + fromTimestamp + "..." + toTimestamp);
                        }
                        this.log("Retrieving from blocks " + fromBlock + "..." + toBlock);
                        adminFeeFilter = Object.assign({}, this.adminFeeFilter, { fromBlock: fromBlock, toBlock: toBlock });
                        blockCreateFilter = Object.assign({}, this.blockCreateFilter, { fromBlock: fromBlock, toBlock: toBlock });
                        tokenTransferFilter = Object.assign({}, this.tokenTransferFilter, { fromBlock: fromBlock, toBlock: toBlock });
                        return [4 /*yield*/, this.eth.getLogs(adminFeeFilter)];
                    case 2:
                        adminFeeEvents = _b.sent();
                        return [4 /*yield*/, this.eth.getLogs(blockCreateFilter)];
                    case 3:
                        blockCreateEvents = _b.sent();
                        return [4 /*yield*/, this.eth.getLogs(tokenTransferFilter)
                            // "if you use v5, you can use contract.queryFilter, which will include the parsed events" https://github.com/ethers-io/ethers.js/issues/37
                        ];
                    case 4:
                        transferEvents = _b.sent();
                        // "if you use v5, you can use contract.queryFilter, which will include the parsed events" https://github.com/ethers-io/ethers.js/issues/37
                        parseLogs(this.contract.interface, adminFeeEvents);
                        parseLogs(this.contract.interface, blockCreateEvents);
                        parseLogs(this.token.interface, transferEvents);
                        events = mergeEventLists(mergeEventLists(adminFeeEvents, blockCreateEvents), transferEvents);
                        // TODO: maybe harvest block timestamps from provider in the background after start-up, save to store?
                        //   Blocking here could last very long during first playback in case of long-lived community...
                        this.log("Retrieving block timestamps for " + events.length + " events...");
                        _i = 0, events_1 = events;
                        _b.label = 5;
                    case 5:
                        if (!(_i < events_1.length)) return [3 /*break*/, 8];
                        event_2 = events_1[_i];
                        _a = event_2;
                        return [4 /*yield*/, this.getBlockTimestamp(event_2.blockNumber)];
                    case 6:
                        _a.timestamp = _b.sent();
                        _b.label = 7;
                    case 7:
                        _i++;
                        return [3 /*break*/, 5];
                    case 8:
                        this.log("Getting messages between " + fromTimestamp + "..." + toTimestamp + " from cache");
                        fromIndex = bisectFindFirstIndex(this.messageCache, function (msg) { return msg.timestamp > fromTimestamp; });
                        toIndex = bisectFindFirstIndex(this.messageCache, function (msg) { return msg.timestamp > toTimestamp; });
                        messages = this.messageCache.slice(fromIndex, toIndex);
                        this.log("Replaying " + events.length + " events and " + messages.length + " messages");
                        return [4 /*yield*/, replayOn(plasma, events, messages)];
                    case 9:
                        _b.sent();
                        plasma.currentBlock = toBlock;
                        plasma.currentTimestamp = toTimestamp;
                        lastPublishedBlock = blockCreateEvents && blockCreateEvents.length > 0 ? blockCreateEvents.slice(-1)[0].args : { blockNumber: 0 };
                        return [2 /*return*/, lastPublishedBlock];
                }
            });
        });
    };
    /**
     * Prune message cache after they aren't going to be needed anymore
     * TODO: move to streamrChannel as channelPruneCache(lastRemovedTimestamp)
     * TODO: @param {Number} lastRemovedTimestamp up to which messages are dropped
     */
    MonoplasmaWatcher.prototype.channelPruneCache = function () {
        var lastRemovedTimestamp = this.plasma.currentTimestamp;
        var keepIndex = bisectFindFirstIndex(this.messageCache, function (msg) { return msg.timestamp > lastRemovedTimestamp; });
        this.messageCache = this.messageCache.slice(keepIndex);
        this.cachePrunedUpTo = lastRemovedTimestamp;
    };
    /**
     * Cache the timestamps of blocks in milliseconds
     * TODO: also store the cache? It's immutable after all...
     * @param {Number} blockNumber
     */
    MonoplasmaWatcher.prototype.getBlockTimestamp = function (blockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(blockNumber in this.blockTimestampCache)) {
                            this.log("blockTimestampCache miss for block number " + blockNumber);
                            this.blockTimestampCache[blockNumber] = (function () { return __awaiter(_this, void 0, void 0, function () {
                                var block;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.eth.getBlock(blockNumber)];
                                        case 1:
                                            block = _a.sent();
                                            if (!block) {
                                                throw new Error("No timestamp exists from block " + blockNumber);
                                            }
                                            return [2 /*return*/, block.timestamp * 1000];
                                    }
                                });
                            }); })();
                        }
                        return [4 /*yield*/, this.blockTimestampCache[blockNumber]];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    /**
     * @returns {BigNumber} the number of token-wei held in the Monoplasma contract
     */
    MonoplasmaWatcher.prototype.getContractTokenBalance = function () {
        return __awaiter(this, void 0, void 0, function () {
            var balance;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.token.methods.balanceOf(this.state.contractAddress).call()];
                    case 1:
                        balance = _a.sent();
                        return [2 /*return*/, balance];
                }
            });
        });
    };
    return MonoplasmaWatcher;
}(EventEmitter));
