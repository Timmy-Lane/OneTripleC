import {
  createWalletClient,
  http,
  type Hex,
  type Chain,
  type Address,
  encodeFunctionData,
  parseAbiItem,
  numberToHex,
  pad,
} from 'viem';
import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
} from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { WalletService } from '../wallet/wallet-service.js';
import {
  findExecutionById,
  updateExecutionState,
} from '../../persistence/repositories/execution-repository.js';
import { findQuoteById } from '../../persistence/repositories/quote-repository.js';
import { findIntentById } from '../../persistence/repositories/intent-repository.js';
import { ExecutionState } from '../../shared/types/index.js';
import type { RouteStep } from '../../shared/types/quote.js';
import { getDeadline } from '../../adapters/dex/utils/deadline.js';

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
};

function getRpcUrl(chainId: number): string {
  switch (chainId) {
    case 1:
      return process.env.ETHEREUM_RPC_URL!;
    case 8453:
      return process.env.BASE_RPC_URL!;
    case 42161:
      return process.env.ARBITRUM_RPC_URL!;
    case 10:
      return process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io';
    case 137:
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    default:
      throw new Error(`RPC URL not configured for chain: ${chainId}`);
  }
}

export interface ExecutionService {
  executeIntent(executionId: string): Promise<{
    txHash: string;
    chainId: number;
  }>;
}

// Router ABI fragments for direct encoding
const ROUTER_V2_ABI_SWAP =
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)';

const ROUTER_V3_ABI_EXACT_INPUT =
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)';

// ERC20 ABI fragments for approval
const ERC20_ABI_ALLOWANCE =
  'function allowance(address owner, address spender) view returns (uint256)';

const ERC20_ABI_APPROVE =
  'function approve(address spender, uint256 amount) returns (bool)';

// Encode V3 path: tokenIn + fee (3 bytes) + tokenOut
function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length !== fees.length + 1) {
    throw new Error('Invalid path: tokens.length must equal fees.length + 1');
  }

  let encoded = tokens[0].toLowerCase();

  for (let i = 0; i < fees.length; i++) {
    const hexFee = pad(numberToHex(fees[i]), { size: 3 }).slice(2);
    const nextToken = tokens[i + 1].slice(2).toLowerCase();
    encoded += hexFee + nextToken;
  }

  return encoded as Hex;
}

// Apply slippage to output amount
function applySlippage(amount: bigint, slippageBps: number): bigint {
  const slippageMultiplier = BigInt(10000 - slippageBps);
  return (amount * slippageMultiplier) / 10000n;
}

export function createExecutionService(
  walletService: WalletService
): ExecutionService {
  // Check ERC20 allowance
  async function checkAllowance(
    tokenAddress: Address,
    ownerAddress: Address,
    spenderAddress: Address,
    chainId: number
  ): Promise<bigint> {
    const rpcUrl = getRpcUrl(chainId);
    const chain = VIEM_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    const { createPublicClient } = await import('viem');
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: [parseAbiItem(ERC20_ABI_ALLOWANCE)],
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
    });

    return allowance as bigint;
  }

  // Execute ERC20 approval
  async function executeApproval(
    tokenAddress: Address,
    spenderAddress: Address,
    amount: bigint,
    walletId: string,
    chainId: number
  ): Promise<string> {
    const privateKey = await walletService.getPrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);

    const chain = VIEM_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    const rpcUrl = getRpcUrl(chainId);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    // Approve max uint256 for better UX (avoid repeated approvals)
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    const calldata = encodeFunctionData({
      abi: [parseAbiItem(ERC20_ABI_APPROVE)],
      functionName: 'approve',
      args: [spenderAddress, maxApproval],
    });

    const txHash = await walletClient.sendTransaction({
      to: tokenAddress,
      data: calldata,
    });

    console.log(`[ExecutionService] Approval tx submitted: ${txHash}`);
    return txHash;
  }

  // Wait for transaction confirmation
  async function waitForConfirmation(
    txHash: string,
    chainId: number,
    maxAttempts: number = 30
  ): Promise<boolean> {
    const rpcUrl = getRpcUrl(chainId);
    const chain = VIEM_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    const { createPublicClient } = await import('viem');
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });

        if (receipt.status === 'success') {
          console.log(`[ExecutionService] Transaction confirmed: ${txHash}`);
          return true;
        } else {
          console.error(`[ExecutionService] Transaction reverted: ${txHash}`);
          return false;
        }
      } catch {
        // Transaction not yet mined, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    throw new Error(`Transaction not confirmed after ${maxAttempts} attempts: ${txHash}`);
  }

  // Build calldata directly for the swap step
  function buildCalldataForStep(
    step: RouteStep,
    recipient: Address,
    slippageBps: number
  ): Hex {
    const fromAmount = BigInt(step.fromAmount);
    const toAmountMin = step.toAmountMin ? BigInt(step.toAmountMin) : 0n;
    const minAmountOut = applySlippage(toAmountMin, slippageBps);
    const deadline = getDeadline(20); // 20 minutes

    if (step.protocol === 'uniswap-v2') {
      // V2: Simple token path array
      const path = [step.fromToken, step.toToken] as Address[];

      return encodeFunctionData({
        abi: [parseAbiItem(ROUTER_V2_ABI_SWAP)],
        functionName: 'swapExactTokensForTokens',
        args: [fromAmount, minAmountOut, path, recipient, deadline],
      });
    } else if (step.protocol === 'uniswap-v3') {
      // V3: Encoded path with fee tier
      const tokens = [step.fromToken as Address, step.toToken as Address];
      const fees = [3000]; // Default 0.3% fee tier
      const encodedPath = encodeV3Path(tokens, fees);

      return encodeFunctionData({
        abi: [parseAbiItem(ROUTER_V3_ABI_EXACT_INPUT)],
        functionName: 'exactInput',
        args: [
          {
            path: encodedPath,
            recipient,
            deadline,
            amountIn: fromAmount,
            amountOutMinimum: minAmountOut,
          },
        ],
      });
    }

    throw new Error(`Unsupported protocol for calldata building: ${step.protocol}`);
  }

  async function executeSwapStep(
    step: RouteStep,
    walletId: string,
    walletAddress: Address,
    chainId: number,
    slippageBps: number
  ): Promise<string> {
    // Get private key
    const privateKey = await walletService.getPrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);

    // Get chain config
    const chain = VIEM_CHAINS[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }

    const rpcUrl = getRpcUrl(chainId);

    // Create wallet client
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    // Build transaction from route step
    if (!step.contractAddress) {
      throw new Error('Route step missing contractAddress');
    }

    // Build calldata if missing or placeholder
    let calldata = step.calldata as Hex | undefined;
    if (!calldata || calldata === '0x') {
      console.log(`[ExecutionService] Building calldata for ${step.protocol}`);
      calldata = buildCalldataForStep(step, walletAddress, slippageBps);
    }

    const tx = {
      to: step.contractAddress as Address,
      data: calldata,
      value: step.fromToken === '0x0000000000000000000000000000000000000000'
        ? BigInt(step.fromAmount)
        : 0n,
    };

    // Sign and submit transaction
    const txHash = await walletClient.sendTransaction(tx);

    return txHash;
  }

  async function executeIntent(executionId: string): Promise<{
    txHash: string;
    chainId: number;
  }> {
    // Get execution record
    const execution = await findExecutionById(executionId);
    if (!execution) {
      throw new Error('Execution not found');
    }

    // Validate state
    if (execution.state !== ExecutionState.PENDING) {
      throw new Error(`Execution not in PENDING state: ${execution.state}`);
    }

    try {
      // Get quote with route
      const quote = await findQuoteById(execution.quoteId);
      if (!quote) {
        throw new Error('Quote not found');
      }

      const route = quote.route as any;
      if (!route.steps || route.steps.length === 0) {
        throw new Error('Quote has no route steps');
      }

      // Get intent to find user
      const intent = await findIntentById(execution.intentId);
      if (!intent) {
        throw new Error('Intent not found');
      }

      // Get user's wallet
      const wallet = await walletService.getWalletByUserId(execution.userId);
      if (!wallet) {
        throw new Error('Wallet not found for user');
      }

      // Get swap steps
      const swapSteps = route.steps.filter((step: RouteStep) => step.type === 'SWAP');

      if (swapSteps.length === 0) {
        throw new Error('No swap steps found in route');
      }

      // Get slippage from route or use default
      const slippageBps = route.slippageBps || 50;

      // Execute first swap step only (MVP: single-step swaps)
      const swapStep = swapSteps[0];

      // Check if source token needs approval (not native ETH)
      const sourceToken = swapStep.fromToken as Address;
      const isNativeToken = sourceToken === '0x0000000000000000000000000000000000000000';

      if (!isNativeToken && swapStep.contractAddress) {
        const fromAmount = BigInt(swapStep.fromAmount);
        const spender = swapStep.contractAddress as Address;

        console.log(`[ExecutionService] Checking allowance for ${sourceToken}`);

        const allowance = await checkAllowance(
          sourceToken,
          wallet.address as Address,
          spender,
          execution.chainId
        );

        console.log(`[ExecutionService] Current allowance: ${allowance}, required: ${fromAmount}`);

        if (allowance < fromAmount) {
          console.log(`[ExecutionService] Insufficient allowance, executing approval`);

          const approvalTxHash = await executeApproval(
            sourceToken,
            spender,
            fromAmount,
            wallet.id,
            execution.chainId
          );

          // Wait for approval to confirm before proceeding
          const confirmed = await waitForConfirmation(approvalTxHash, execution.chainId);
          if (!confirmed) {
            throw new Error('Approval transaction failed');
          }

          console.log(`[ExecutionService] Approval confirmed, proceeding with swap`);
        }
      }

      const txHash = await executeSwapStep(
        swapStep,
        wallet.id,
        wallet.address as Address,
        execution.chainId,
        slippageBps
      );

      // Update execution state to SUBMITTED
      await updateExecutionState(executionId, ExecutionState.SUBMITTED, {
        txHash,
        submittedAt: new Date(),
      });

      return {
        txHash,
        chainId: execution.chainId,
      };
    } catch (error) {
      // Update execution state to FAILED
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      await updateExecutionState(executionId, ExecutionState.FAILED, {
        errorMessage,
      });

      throw error;
    }
  }

  return {
    executeIntent,
  };
}
