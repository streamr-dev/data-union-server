pragma solidity ^0.4.24;

import "monoplasma/contracts/Monoplasma.sol";

contract CommunityProduct is Monoplasma {

    string public joinPartStream;

    constructor(address operator, string joinPartStreamId, address tokenAddress, uint blockFreezePeriodSeconds, uint adminFeeFraction)
    Monoplasma(tokenAddress, blockFreezePeriodSeconds, adminFeeFraction) public {
        setOperator(operator);
        joinPartStream = joinPartStreamId;
    }
}