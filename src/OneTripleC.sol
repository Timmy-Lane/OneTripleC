// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IV3SwapRouter.sol";

contract OneTripleC is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable swapRouter;
    mapping(address => bool) public isExecutor;
    uint256 public constant MAX_BATCH = 16;

    struct SingleSwap {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMin;
        uint256 deadline;
        uint160 sqrtPriceLimitX96; // 0 = no limit
    }

    struct MultiHopSwap {
        bytes path; // tokenA + fee + tokenB + fee + tokenC
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMin;
    }

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotExecutor(msg.sender);
        _;
    }

    event ExecutorAdded(address indexed executor);
    event ExecutorRemoved(address indexed executor);
    event SingleSwapExecuted(
        address indexed executor,
        address indexed tokenIn,
        address indexed tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut,
        uint256 amountOutMin
    );
    event MultiHopSwapExecuted(
        address indexed executor,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 amountOutMin
    );
    event BatchSwapExecuted(address indexed executor, uint256 count);

    event Swept(address indexed token, address indexed to, uint256 amount);
    event SweptETH(address indexed to, uint256 amount);

    error ZeroAddress();
    error NotExecutor(address);
    error InvalidToken();
    error InvalidAmount();
    error DeadlineExpired(uint256, uint256);
    error BatchTooLarge(uint256, uint256);
    error InvalidPath();

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

    function swapSingle(
        SingleSwap calldata s
    ) external onlyExecutor nonReentrant returns (uint256) {
        return _executeExactInputSingle(s);
    }

    function batchSwapSingle(
        SingleSwap[] calldata ss
    ) external nonReentrant onlyExecutor returns (uint256[] memory amountOuts) {
        uint256 len = ss.length;

        if (len == 0 || len > MAX_BATCH) {
            revert BatchTooLarge(len, MAX_BATCH);
        }

        amountOuts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            amountOuts[i] = _executeExactInputSingle(ss[i]);
        }

        emit BatchSwapExecuted(msg.sender, len);
    }

    function swapMultiHop(
        MultiHopSwap calldata s
    ) external onlyExecutor nonReentrant returns (uint256) {
        return _executeExactInput(s);
    }

    function _executeExactInputSingle(
        SingleSwap calldata s
    ) internal returns (uint256 amountOut) {
        if (s.tokenIn == address(0) || s.tokenOut == address(0)) {
            revert InvalidToken();
        }

        if (s.amountIn == 0) {
            revert InvalidAmount();
        }

        if (block.timestamp > s.deadline) {
            revert DeadlineExpired(block.timestamp, s.deadline);
        }

        IERC20(s.tokenIn).forceApprove(swapRouter, 0);
        IERC20(s.tokenIn).safeIncreaseAllowance(swapRouter, s.amountIn);

        IV3SwapRouter.ExactInputSingleParams memory params = IV3SwapRouter
            .ExactInputSingleParams({
                tokenIn: s.tokenIn,
                tokenOut: s.tokenOut,
                fee: s.fee,
                recipient: address(this),
                deadline: s.deadline,
                amountIn: s.amountIn,
                amountOutMinimum: s.amountOutMin,
                sqrtPriceLimitX96: s.sqrtPriceLimitX96
            });

        amountOut = IV3SwapRouter(swapRouter).exactInputSingle(params);

        emit SingleSwapExecuted(
            msg.sender,
            s.tokenIn,
            s.tokenOut,
            s.fee,
            s.amountIn,
            amountOut,
            s.amountOutMin
        );
    }

    function _executeExactInput(
        MultiHopSwap calldata s
    ) internal returns (uint256 amountOut) {
        if (s.path.length == 0) revert InvalidPath();
        if (s.amountIn == 0) revert InvalidAmount();
        if (block.timestamp > s.deadline) {
            revert DeadlineExpired(block.timestamp, s.deadline);
        }

        address tokenIn;
        assembly {
            tokenIn := shr(96, calldataload(s))
        }

        IERC20(tokenIn).forceApprove(swapRouter, 0);
        IERC20(tokenIn).safeIncreaseAllowance(swapRouter, s.amountIn);

        amountOut = IV3SwapRouter(swapRouter).exactInput(
            IV3SwapRouter.ExactInputParams({
                path: s.path,
                recipient: address(this),
                deadline: s.deadline,
                amountIn: s.amountIn,
                amountOutMinimum: s.amountOutMin
            })
        );

        emit MultiHopSwapExecuted(
            msg.sender,
            tokenIn,
            s.amountIn,
            amountOut,
            s.amountOutMin
        );
    }

    function sweepToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    function sweepETH(
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "ETH_TRANSFER_FAIL");
        emit SweptETH(to, amount);
    }

    receive() external payable {}
}
