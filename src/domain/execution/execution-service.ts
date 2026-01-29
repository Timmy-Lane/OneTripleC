import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type Chain,
  type Address,
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
import type { RouteStep, RouteStepType } from '../../shared/types/quote.js';

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

export function createExecutionService(
  walletService: WalletService
): ExecutionService {
  async function executeSwapStep(
    step: RouteStep,
    walletId: string,
    chainId: number
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
    if (!step.contractAddress || !step.calldata) {
      throw new Error('Route step missing contractAddress or calldata');
    }

    const tx = {
      to: step.contractAddress as Address,
      data: step.calldata as Hex,
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

      // For MVP: Execute only SWAP steps, skip APPROVE steps
      const swapSteps = route.steps.filter((step: RouteStep) => step.type === 'SWAP');

      if (swapSteps.length === 0) {
        throw new Error('No swap steps found in route');
      }

      // Execute first swap step only (MVP: single-step swaps)
      const swapStep = swapSteps[0];
      const txHash = await executeSwapStep(
        swapStep,
        wallet.id,
        execution.chainId
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
