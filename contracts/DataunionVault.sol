pragma solidity ^0.5.16;

import "monoplasma/contracts/Monoplasma.sol";

contract DataunionVault is Monoplasma {

    string public joinPartStream;

    /** Server version. This must be kept in sync with src/server.js */
    uint public version = 1;

    constructor(address operator, string memory joinPartStreamId, address tokenAddress, uint blockFreezePeriodSeconds, uint adminFeeFraction)
    Monoplasma(tokenAddress, blockFreezePeriodSeconds, adminFeeFraction) public {
        setOperator(operator);
        joinPartStream = joinPartStreamId;
    }
}
