pragma solidity ^0.4.24;

import "monoplasma/contracts/Monoplasma.sol";

contract CommunityProduct is Monoplasma {

    string public joinPartStream;
    string public syncStream;

    constructor(address operator, string joinPartStreamId, string syncStreamId, address tokenAddress, uint blockFreezePeriodSeconds)
    Monoplasma(tokenAddress, blockFreezePeriodSeconds) public {
        setOperator(operator);
        joinPartStream = joinPartStreamId;
        syncStream = syncStreamId;
    }
}