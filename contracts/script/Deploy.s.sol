// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OneTripleC.sol";

contract Deploy is Script {
    function run() external {
        address router = vm.envAddress("SWAP_ROUTER");

        vm.startBroadcast();
        OneTripleC c = new OneTripleC(router);
        vm.stopBroadcast();

        console2.log("OneTripleC deployed at:", address(c));
    }
}
