export interface Store {
    getLatestBlock(): any;
    hasLatestBlock(): boolean;
    storeBlock(blockNumber: BigInt, commitTimestamp: number): void;
}
