// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OneTripleC.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SeedExecute is Script {
    function run() external {
        address otcAdr = vm.envAddress("OTC");
        address tokenIn = vm.envAddress("TOKEN_IN");
        address executor = vm.envAddress("EXECUTOR");

        OneTripleC otc = new OneTripleC(otcAdr);

        vm.startBroadcast();

        otc.addExecutor(executor);

        IERC20(tokenIn).transfer(otcAdr, 1 ether);

        vm.stopBroadcast();
    }
}
