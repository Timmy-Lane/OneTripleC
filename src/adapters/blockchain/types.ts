import { Address, Hex } from 'viem';

export interface TransactionRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
}

export interface TransactionResult {
  hash: Hex;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

export interface ContractCallParams {
  address: Address;
  abi: any[];
  functionName: string;
  args?: any[];
}

export interface SimulateContractParams extends ContractCallParams {
  value?: bigint;
  account?: Address;
}
