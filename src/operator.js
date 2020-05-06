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
var ethers_1 = require("ethers");
var sleep = require("./utils/sleep-promise");
var throwIfBadAddress = require("./utils/checkArguments").throwIfBadAddress;
var MonoplasmaWatcher = require("./watcher");
var MonoplasmaState = require("./state");
var MonoplasmaJson = require("../build/Monoplasma.json");
var debug = require("debug");
module.exports = /** @class */ (function () {
    function MonoplasmaOperator(wallet, joinPartChannel, store) {
        this.wallet = wallet;
        this.watcher = new MonoplasmaWatcher(wallet.provider, joinPartChannel, store);
        this.lastSavedBlock = null;
    }
    MonoplasmaOperator.prototype.start = function (config) {
        return __awaiter(this, void 0, void 0, function () {
            var finalPlasmaStore;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        throwIfBadAddress(config.operatorAddress, "MonoplasmaOperator argument config.operatorAddress");
                        this.log = debug("Streamr::dataunion::operator::" + config.contractAddress);
                        this.finalityWaitPeriodSeconds = config.finalityWaitPeriodSeconds || 1; // TODO: in production || 3600
                        this.address = config.operatorAddress;
                        this.gasPrice = config.gasPrice || 4000000000; // 4 gwei
                        this.contract = new ethers_1.Contract(config.contractAddress, MonoplasmaJson.abi, this.wallet);
                        // TODO: replace minIntervalBlocks with tokensNotCommitted (value-at-risk)
                        this.minIntervalBlocks = config.minIntervalBlocks || 1;
                        //this.tokensNotCommitted = 0    // TODO: bignumber
                        return [4 /*yield*/, this.watcher.start(config)
                            //this.lastPublishedBlock = (this.watcher.state.lastPublishedBlock && this.watcher.state.lastPublishedBlock.blockNumber) || 0
                            // TODO https://streamr.atlassian.net/browse/dataunion-82 finalPlasmaStore should be instead just this.watcher.plasma.store
                        ];
                    case 1:
                        //this.tokensNotCommitted = 0    // TODO: bignumber
                        _a.sent();
                        finalPlasmaStore = {
                            saveBlock: function (block) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    this.lastSavedBlock = block;
                                    return [2 /*return*/];
                                });
                            }); }
                        };
                        this.finalPlasma = new MonoplasmaState({
                            blockFreezeSeconds: 0,
                            initialMembers: this.watcher.plasma.members,
                            store: finalPlasmaStore,
                            adminAddress: this.watcher.plasma.adminAddress,
                            adminFeeFraction: this.watcher.plasma.adminFeeFraction,
                            initialBlockNumber: this.watcher.plasma.currentBlock,
                            initialTimestamp: this.watcher.plasma.currentTimestamp
                        });
                        this.watcher.on("tokensReceived", function (event) { return _this.onTokensReceived(event).catch(_this.log); });
                        return [2 /*return*/];
                }
            });
        });
    };
    MonoplasmaOperator.prototype.shutdown = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.log("Shutting down operator for contract: " + this.watcher.state.contractAddress);
                        return [4 /*yield*/, this.watcher.stop()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    MonoplasmaOperator.prototype.lastPublishedBlock = function () {
        return __awaiter(this, void 0, void 0, function () {
            var lb;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.watcher.plasma.store.getLatestBlock()];
                    case 1:
                        lb = _a.sent();
                        if (lb == undefined) {
                            return [2 /*return*/, undefined];
                        }
                        return [2 /*return*/, lb.blockNumber];
                }
            });
        });
    };
    // TODO: block publishing should be based on value-at-risk, that is, publish after so-and-so many tokens received
    // see https://streamr.atlassian.net/browse/dataunion-39
    MonoplasmaOperator.prototype.onTokensReceived = function (event) {
        return __awaiter(this, void 0, void 0, function () {
            var last, blockNumber;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.lastPublishedBlock()];
                    case 1:
                        last = _a.sent();
                        blockNumber = event.blockNumber;
                        if (!(last == undefined || +blockNumber >= last + +this.minIntervalBlocks)) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.publishBlock(blockNumber)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        this.log("Skipped publishing at " + blockNumber + ", last publish at " + last + " (this.minIntervalBlocks = " + this.minIntervalBlocks + ")");
                        _a.label = 4;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    MonoplasmaOperator.prototype.publishBlock = function (rootchainBlockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var task;
            var _this = this;
            return __generator(this, function (_a) {
                // enqueue publishBlock calls
                if (this.inProgressPublish) {
                    this.log("Queued block publish", rootchainBlockNumber);
                }
                task = Promise.resolve(this.inProgressPublish)
                    .then(function () { return _this._publishBlock(rootchainBlockNumber); })
                    .finally(function () {
                    // last task cleans up
                    if (_this.inProgressPublish === task) {
                        _this.inProgressPublish = undefined;
                    }
                });
                this.inProgressPublish = task;
                return [2 /*return*/, task];
            });
        });
    };
    // TODO: call it commit instead. Replace all mentions of "publish" with "commit".
    /**
     * Sync watcher to the given block and publish the state AFTER it into blockchain
     * @param {Number} rootchainBlockNumber to sync up to
     * @returns {Promise<TransactionReceipt>}
     */
    MonoplasmaOperator.prototype._publishBlock = function (rootchainBlockNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var state, blockNumber, lastPublishedBlock, log, hash, ipfsHash, tx, tr, commitTimestamp, block;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        state = this.watcher.plasma.clone();
                        return [4 /*yield*/, sleep(0)]; // ensure lastObservedBlockNumber is updated since this likely happens as a response to event
                    case 1:
                        _a.sent(); // ensure lastObservedBlockNumber is updated since this likely happens as a response to event
                        blockNumber = rootchainBlockNumber || this.watcher.state.lastObservedBlockNumber;
                        return [4 /*yield*/, this.lastPublishedBlock()];
                    case 2:
                        lastPublishedBlock = _a.sent();
                        if (blockNumber <= lastPublishedBlock) {
                            throw new Error("Block #" + lastPublishedBlock + " has already been published, can't publish #" + blockNumber);
                        }
                        log = this.log.extend(blockNumber);
                        log("Publish block", blockNumber);
                        return [4 /*yield*/, state.prepareRootHash(blockNumber)]; // TODO: remove, uncomment above
                    case 3:
                        hash = _a.sent() // TODO: remove, uncomment above
                        ;
                        ipfsHash = "" // TODO: upload this.finalPlasma to IPFS while waiting for finality
                        ;
                        return [4 /*yield*/, this.contract.commit(blockNumber, hash, ipfsHash)];
                    case 4:
                        tx = _a.sent();
                        return [4 /*yield*/, tx.wait()
                            // TODO this should probably just happen through watcher noticing the NewCommit event?
                            // TODO https://streamr.atlassian.net/browse/dataunion-82 should be instead:
                            // await this.finalPlasma.storeBlock(blockNumber) // TODO: give a timestamp
                            // this.watcher.state.lastPublishedBlock = {blockNumber: blockNumber}
                        ]; // confirmations
                    case 5:
                        tr = _a.sent() // confirmations
                        ;
                        return [4 /*yield*/, this.contract.blockTimestamp(blockNumber)];
                    case 6:
                        commitTimestamp = (_a.sent()).toNumber();
                        return [4 /*yield*/, state.storeBlock(blockNumber, commitTimestamp)
                            // TODO: how many times is this done now?!
                            // update watcher plasma's block list
                        ];
                    case 7:
                        block = _a.sent();
                        // TODO: how many times is this done now?!
                        // update watcher plasma's block list
                        this.watcher.plasma.latestBlocks.unshift(block);
                        // ensure blocks are in order
                        this.watcher.plasma.latestBlocks.sort(function (a, b) { return b.blockNumber - a.blockNumber; });
                        log("Latest blocks: " + JSON.stringify(this.watcher.plasma.latestBlocks.map(function (b) { return Object.assign({}, b, { members: b.members.length }); })));
                        this.log("Commit sent, receipt: " + JSON.stringify(tr));
                        // TODO: something causes events to be replayed many times, resulting in wrong balances. It could have something to do with the state cloning that happens here
                        // replace watcher's MonoplasmaState with the final "true" state that was just committed to blockchain
                        // also sync it up to date because it's supposed to be "real time"
                        // TODO: there could be a glitch here: perhaps an event gets replayed while syncing, it will be missed when watcher.plasma is overwritten
                        //         of course it will be fixed again after next commit
                        //this.watcher.setState(this.finalPlasma)
                        //const currentBlock = await this.wallet.provider.getBlockNumber()
                        //this.watcher.playbackUntilBlock(currentBlock)
                        this.watcher.channelPruneCache(); // TODO: move inside watcher, maybe after playback
                        return [2 /*return*/];
                }
            });
        });
    };
    return MonoplasmaOperator;
}());
