interface Store {
    getLatestBlock();
    storeBlock(blockNumber : BigInt, commitTimestamp : number) : void;
}
