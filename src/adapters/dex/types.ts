export interface SwapQuote {
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

export interface DexAdapter {
  getQuote(params: {
    chainId: number;
    fromToken: string;
    toToken: string;
    amount: string;
    slippageBps?: number;
  }): Promise<SwapQuote>;
}
