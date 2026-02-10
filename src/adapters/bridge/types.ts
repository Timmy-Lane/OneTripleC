import type { Address, Hex } from 'viem';

export interface BridgeQuoteParams {
  sourceChainId: number;
  destinationChainId: number;
  token: Address;
  amount: bigint;
  recipient: Address;
}

export interface BridgeQuote {
  provider: string;
  sourceChainId: number;
  destinationChainId: number;
  token: Address;
  amount: bigint;
  estimatedOutput: bigint;
  relayFeePct: string;
  lpFeePct: string;
  quoteTimestamp: number;
  spokePoolAddress: Address;
  estimatedGas: bigint;
}

export interface BridgeAdapter {
  getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null>;
  buildBridgeTransaction(
    quote: BridgeQuote,
    sender: Address
  ): Promise<{ to: Address; data: Hex; value: bigint }>;
}
