import { Address, Hex } from 'viem';

export type DexVersion = 'v2' | 'v3' | 'v4';

export interface V2PoolData {
  reserve0: bigint;
  reserve1: bigint;
}

export interface V3PoolData {
  fee: number;
  tickSpacing?: number;
  sqrtPriceX96?: bigint;
  liquidity?: bigint;
}

export interface Pool {
  address: Address;
  token0: Address;
  token1: Address;
  dex: string;
  version: DexVersion;
  chainId: number;
  v2Data?: V2PoolData;
  v3Data?: V3PoolData;
}

export interface IntermediatePool extends Pool {
  isIntermediate: true;
}

export interface SwapPath {
  pools: Pool[];
  tokens: Address[];
  encodedPath?: Hex;
}

export interface QuoteParams {
  chainId: number;
  fromToken: Address;
  toToken: Address;
  amount: bigint;
  side: 'BUY' | 'SELL';
  slippageBps?: number;
  intermediateTokens?: Address[];
}

export interface QuoteResult {
  pool: Pool;
  intermediatePool?: IntermediatePool;
  secondIntermediatePool?: IntermediatePool;
  amountIn: bigint;
  amountOut: bigint;
  path: SwapPath;
  priceImpactBps: number;
  estimatedGas: bigint;
}

export interface SwapQuote {
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  toAmount: bigint;
  protocol: string;
  dexAddress: Address;
  calldata: Hex;
  estimatedGas: bigint;
  fee: bigint;
  path: SwapPath;
  pool: Pool;
  intermediatePool?: IntermediatePool;
  secondIntermediatePool?: IntermediatePool;
}

export interface BatchQuoteParams {
  chainId: number;
  pool: Pool;
  intermediatePool?: IntermediatePool;
  secondIntermediatePool?: IntermediatePool;
  amounts: bigint[];
  wethPrice: number;
}

export interface BatchQuoteResult {
  buy: QuoteExactResult[];
  sell: QuoteExactResult[];
}

export interface QuoteExactResult {
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
}

export interface MultiIntervalQuotes {
  [interval: string]: {
    buy: IntervalQuote;
    sell: IntervalQuote;
  };
}

export interface IntervalQuote {
  pool: Pool;
  intermediatePool?: IntermediatePool;
  secondIntermediatePool?: IntermediatePool;
  amountIn: string;
  amountOut: string;
  amountInReadable: number;
  amountOutReadable: number;
  rate: number;
}

export interface DexAdapter {
  getQuote(params: QuoteParams): Promise<SwapQuote | null>;
  
  batchQuote?(params: BatchQuoteParams): Promise<MultiIntervalQuotes | null>;
  
  buildSwapTransaction(
    quote: SwapQuote,
    recipient: Address,
    slippageBps: number
  ): Promise<{ to: Address; data: Hex; value: bigint }>;
}

export interface SimulateContractParams {
  address: Address;
  abi: any[];
  functionName: string;
  args: any[];
  value?: bigint;
}
