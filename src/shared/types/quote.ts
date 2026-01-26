export enum RouteStepType {
  APPROVE = 'APPROVE',
  SWAP = 'SWAP',
  BRIDGE = 'BRIDGE',
  TRANSFER = 'TRANSFER',
}

export interface RouteStep {
  type: RouteStepType;
  chainId: number;
  protocol: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmountMin?: string;
  spender?: string;
  contractAddress?: string;
  calldata?: string;
  estimatedGas?: string;
}

export interface RouteFees {
  gasEstimate: string;
  protocolFee: string;
  bridgeFee: string;
  dexFee: string;
}

export interface QuoteRoute {
  steps: RouteStep[];
  fees: RouteFees;
  estimatedTime?: number;
  slippageBps: number;
  provider: string;
}

export interface Quote {
  id: string;
  intentId: string;
  route: QuoteRoute;
  estimatedOutput: string;
  totalFee: string;
  expiresAt: string;
  isAccepted: boolean;
  createdAt: string;
}
