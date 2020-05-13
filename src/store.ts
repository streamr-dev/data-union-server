export interface Store {
    blockExists() : boolean;
    getLatestBlock();
    hasLatestBlock() : boolean;
    storeBlock(blockNumber : BigInt, commitTimestamp : number) : void;
}
