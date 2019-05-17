pragma solidity ^0.4.24;

import "monoplasma/contracts/Monoplasma.sol";

contract CommunityProduct is Monoplasma {

    string public joinPartStream;

    constructor(address operator, string joinPartStreamId, address tokenAddress, uint blockFreezePeriodSeconds)
    Monoplasma(tokenAddress, blockFreezePeriodSeconds) public {
        setOperator(operator);
        joinPartStream = joinPartStreamId;
    }
}