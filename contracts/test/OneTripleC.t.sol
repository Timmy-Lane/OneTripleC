// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/OneTripleC.sol";
import "./mocks/mockERC20.sol";
import "./mocks/mockV3SwapRouter.sol";

contract OTCTest is Test {
    OneTripleC otc;
    MockV3SwapRouter router;

    MockERC20 tokenA = new MockERC20("TokenA", "A");
    MockERC20 tokenB = new MockERC20("TokenB", "B");
    MockERC20 tokenC = new MockERC20("TokenC", "C");

    address executor = address(0x001);

    function setUp() external {
        router = new MockV3SwapRouter();
        otc = new OneTripleC(address(router));

        otc.addExecutor(executor);

        tokenA.mint(address(otc), 100 ether);

        router.setShouldRevert(false);
        router.setFixedAmountOut(0);
    }

    function test_singleSwap_success() external {
        OneTripleC.SingleSwap memory s = OneTripleC.SingleSwap({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            fee: 3000,
            amountIn: 10 ether,
            amountOutMin: 0,
            deadline: block.timestamp + 60,
            sqrtPriceLimitX96: 0
        });

        vm.prank(executor);
        uint256 out = otc.swapSingle(s);

        assertEq(out, 10 ether);
        assertEq(tokenB.balanceOf(address(otc)), 10 ether);
    }

    function test_batch_atomicity() external {
        OneTripleC.SingleSwap[] memory ss = new OneTripleC.SingleSwap[](2);

        ss[0] = OneTripleC.SingleSwap({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            fee: 3000,
            amountIn: 5 ether,
            amountOutMin: 0,
            deadline: block.timestamp + 60,
            sqrtPriceLimitX96: 0
        });

        ss[1] = OneTripleC.SingleSwap({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            fee: 3000,
            amountIn: 5 ether,
            amountOutMin: 0,
            deadline: block.timestamp - 1,
            sqrtPriceLimitX96: 0
        });

        uint256 aBefore = tokenA.balanceOf(address(otc));

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                OneTripleC.DeadlineExpired.selector,
                block.timestamp,
                ss[1].deadline
            )
        );
        otc.batchSwapSingle(ss);

        assertEq(tokenA.balanceOf(address(otc)), aBefore);
    }

    function test_multiHop_success() external {
        bytes memory path = abi.encodePacked(
            address(tokenA),
            uint24(3000),
            address(tokenB),
            uint24(3000),
            address(tokenC)
        );

        OneTripleC.MultiHopSwap memory s = OneTripleC.MultiHopSwap({
            tokenIn: address(tokenA),
            path: path,
            amountIn: 20 ether,
            amountOutMin: 0,
            deadline: block.timestamp + 60
        });

        vm.prank(executor);
        uint256 out = otc.swapMultiHop(s);

        assertEq(out, 20 ether);
        assertEq(tokenC.balanceOf(address(otc)), 20 ether);
    }

    function test_multiHop_reverts_invalidPath() external {
        OneTripleC.MultiHopSwap memory s = OneTripleC.MultiHopSwap({
            tokenIn: address(tokenA),
            path: "",
            amountIn: 1 ether,
            amountOutMin: 0,
            deadline: block.timestamp + 60
        });

        vm.prank(executor);
        vm.expectRevert(OneTripleC.InvalidPath.selector);
        otc.swapMultiHop(s);
    }
}
