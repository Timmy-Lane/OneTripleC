// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IUniswapV3Router.sol";

contract OneTripleC is Ownable, ReentrancyGuard {
    address public immutable swapRouter;
    mapping(address => bool) public isExecutor;
    uint256 public constant MAX_BATCH = 16;

    struct SwapInstruction {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMin;
        uint256 deadline;
        uint160 sqrtPriceLimitX96;
    }

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotExecutor(msg.sender);
        _;
    }

    event ExecutorAdded(address indexed executor);
    event ExecutorRemoved(address indexed executor);

    error ZeroAddress();
    error NotExecutor(address);
    error InvalidToken();
    error InvalidAmount();
    error DeadlineExpired(uint256, uint256);
    error BatchTooLarge(uint256, uint256);

    constructor(address _swapRouter) Ownable(msg.sender) {
        if (_swapRouter == address(0)) revert ZeroAddress();
        swapRouter = _swapRouter;
    }

    function addExecutor(address executor) external onlyOwner {
        if (executor == address(0)) revert ZeroAddress();
        if (isExecutor[executor]) return;

        isExecutor[executor] = true;
        emit ExecutorAdded(executor);
    }

    function removeExecutor(address executor) external onlyOwner {
        if (isExecutor[executor]) return;

        isExecutor[executor] = false;
        emit ExecutorRemoved(executor);
    }
}
