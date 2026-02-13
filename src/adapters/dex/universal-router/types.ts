import { Address, Hex } from 'viem';

export interface UniversalRouterConfig {
  chainId: number;
  rpcUrl: string;
}

export interface SwapOptions {
  slippageBps: number;
  deadline: bigint;
  recipient: Address;
}

export interface V3SwapExactInParams {
  recipient: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  path: Hex;  // Encoded V3 path
  payerIsUser: boolean;
}

export interface V2SwapExactInParams {
  recipient: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  path: Address[];  // Simple address array
  payerIsUser: boolean;
}

export interface Permit2PermitParams {
  token: Address;
  amount: bigint;  // uint160
  expiration: number;  // uint48 timestamp
  nonce: number;  // uint48
  spender: Address;  // UniversalRouter address
  sigDeadline: bigint;
}

export interface UnwrapWethParams {
  recipient: Address;
  amountMin: bigint;
}

export interface SweepParams {
  token: Address;
  recipient: Address;
  amountMin: bigint;
}

export interface EncodedTransaction {
  to: Address;
  data: Hex;
  value: bigint;
}
