// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IV3SwapRouter
/// @notice Minimal Uniswap v3 SwapRouter interface for exactInputSingle execution
/// @dev Intentionally minimal for portfolio / execution-only usage
interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Swaps a fixed amount of one token for as much as possible of another token
    /// @param params The parameters necessary for the swap, encoded as ExactInputSingleParams
    /// @return amountOut The amount of the received token
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external returns (uint256 amountOut);

    function exactInput(
        ExactInputParams calldata params
    ) external returns (uint256 amountOut);
}
