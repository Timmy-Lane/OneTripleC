// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IV3SwapRouter} from "../../src/interfaces/IV3SwapRouter.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

contract MockV3SwapRouter is IV3SwapRouter {
    bool public shouldRevert;
    uint256 public fixedAmountOut; // if 0 -> amountOut = amountIn (1:1)

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function setFixedAmountOut(uint256 v) external {
        fixedAmountOut = v;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external override returns (uint256 amountOut) {
        if (shouldRevert) revert("MOCK_ROUTER_REVERT");

        IERC20(params.tokenIn).transferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );

        amountOut = fixedAmountOut == 0 ? params.amountIn : fixedAmountOut;

        require(amountOut >= params.amountOutMinimum, "SLIPPAGE");

        IMintable(params.tokenOut).mint(params.recipient, amountOut);

        return amountOut;
    }
}
