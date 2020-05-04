interface Store {
    getLatestBlock(): any;
    storeBlock(blockNumber: BigInt, commitTimestamp: number): void;
}
