export enum ChainId {
  ETHEREUM = 1,
  BASE = 8453,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  POLYGON = 137,
}

export enum IntentState {
  CREATED = 'CREATED',
  PARSING = 'PARSING',
  PARSED = 'PARSED',
  QUOTE_REQUESTED = 'QUOTE_REQUESTED',
  QUOTED = 'QUOTED',
  ACCEPTED = 'ACCEPTED',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum ExecutionState {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum TxState {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

export enum RouteStepType {
  SWAP = 'SWAP',
  BRIDGE = 'BRIDGE',
}

export interface Intent {
  id: string;
  userId: string;
  rawMessage: string;
  sourceChainId: ChainId | null;
  targetChainId: ChainId | null;
  sourceToken: string | null;
  targetToken: string | null;
  sourceAmount: string | null;
  minTargetAmount: string | null;
  slippageBps: number | null;
  parsingConfidence: string | null;
  state: IntentState;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  intentId: string;
  estimatedOutput: string;
  estimatedGasCost: string;
  route: RouteStep[];
  expiresAt: string;
  createdAt: string;
}

export interface Execution {
  id: string;
  intentId: string;
  quoteId: string;
  state: ExecutionState;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export interface RouteStep {
  type: RouteStepType;
  chainId: ChainId;
  protocol: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  dexAddress: string | null;
  bridgeAddress: string | null;
  txHash: string | null;
  txState: TxState;
  gasUsed: string | null;
  error: string | null;
}
