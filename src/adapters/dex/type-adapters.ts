import { Address } from 'viem';
import type { SwapQuote as InternalSwapQuote, Pool } from './types.js';
import type { RouteStep } from '../../shared/types/quote.js';
import { RouteStepType } from '../../shared/types/quote.js';

export interface LegacySwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  protocol: string;
  dexAddress: string;
  calldata: string;
  estimatedGas: string;
  fee: string;
}

export function toLegacySwapQuote(quote: InternalSwapQuote): LegacySwapQuote {
  return {
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    fromAmount: quote.fromAmount.toString(),
    toAmount: quote.toAmount.toString(),
    protocol: quote.protocol,
    dexAddress: quote.dexAddress,
    calldata: quote.calldata,
    estimatedGas: quote.estimatedGas.toString(),
    fee: quote.fee.toString(),
  };
}

export function toRouteStep(
  quote: InternalSwapQuote,
  chainId: number
): RouteStep {
  return {
    type: RouteStepType.SWAP,
    chainId,
    protocol: quote.protocol,
    fromToken: quote.fromToken,
    toToken: quote.toToken,
    fromAmount: quote.fromAmount.toString(),
    toAmountMin: quote.toAmount.toString(),
    contractAddress: quote.dexAddress,
    calldata: quote.calldata,
    estimatedGas: quote.estimatedGas.toString(),
  };
}

export function needsApproval(
  tokenAddress: Address,
  spender: Address
): boolean {
  const zeroAddress = '0x0000000000000000000000000000000000000000' as Address;
  return tokenAddress.toLowerCase() !== zeroAddress.toLowerCase();
}

export function createApprovalStep(
  tokenAddress: Address,
  spender: Address,
  amount: string,
  chainId: number
): RouteStep {
  return {
    type: RouteStepType.APPROVE,
    chainId,
    protocol: 'erc20',
    fromToken: tokenAddress,
    toToken: tokenAddress,
    fromAmount: amount,
    spender,
    contractAddress: tokenAddress,
  };
}
