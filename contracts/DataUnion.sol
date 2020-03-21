pragma solidity ^0.5.16;

import "monoplasma/contracts/Monoplasma.sol";

contract DataUnion is Monoplasma {

    string public joinPartStream;

    constructor(address operator, string memory joinPartStreamId, address tokenAddress, uint blockFreezePeriodSeconds, uint adminFeeFraction)
    Monoplasma(tokenAddress, blockFreezePeriodSeconds, adminFeeFraction) public {
        setOperator(operator);
        joinPartStream = joinPartStreamId;
    }
}
