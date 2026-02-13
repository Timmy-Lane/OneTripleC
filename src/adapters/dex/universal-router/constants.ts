import { Address } from 'viem';

// universal router v2 addresses per chain
export const UNIVERSAL_ROUTER_ADDRESSES: Record<number, Address> = {
   1: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
   8453: '0x6ff5693b99212da76ad316178a184ab56d299b43',
   42161: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
   10: '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
   137: '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
};

// permit2 (same on all chains)
export const PERMIT2_ADDRESS: Address =
   '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// command ids (from Commands.sol)
export const UR_COMMAND = {
   V3_SWAP_EXACT_IN: 0x00,
   V3_SWAP_EXACT_OUT: 0x01,
   PERMIT2_TRANSFER_FROM: 0x02,
   PERMIT2_PERMIT_BATCH: 0x03,
   SWEEP: 0x04,
   TRANSFER: 0x05,
   PAY_PORTION: 0x06,
   V2_SWAP_EXACT_IN: 0x08,
   V2_SWAP_EXACT_OUT: 0x09,
   PERMIT2_PERMIT: 0x0a,
   WRAP_ETH: 0x0b,
   UNWRAP_WETH: 0x0c,
   PERMIT2_TRANSFER_FROM_BATCH: 0x0d,
   BALANCE_CHECK_ERC20: 0x0e,
   V4_SWAP: 0x10,
   EXECUTE_SUB_PLAN: 0x21,
} as const;

// flag to allow a command to revert without failing the entire tx
export const FLAG_ALLOW_REVERT = 0x80;

// special recipient addresses resolved by the router
// MSG_SENDER resolves to the original caller
export const UR_RECIPIENT_SENDER: Address =
   '0x0000000000000000000000000000000000000001';
// ADDRESS_THIS resolves to the router itself (for intermediate steps)
export const UR_RECIPIENT_ROUTER: Address =
   '0x0000000000000000000000000000000000000002';

// minimal ABI for UniversalRouter.execute
export const UNIVERSAL_ROUTER_ABI = [
   {
      name: 'execute',
      type: 'function',
      stateMutability: 'payable',
      inputs: [
         { name: 'commands', type: 'bytes' },
         { name: 'inputs', type: 'bytes[]' },
         { name: 'deadline', type: 'uint256' },
      ],
      outputs: [],
   },
] as const;

// V3 Fee Tiers
export const FeeAmount = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000,    // 1%
} as const;

// Permit2 ABI (minimal, just allowance function for nonce fetching)
export const PERMIT2_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
] as const;

export function getUniversalRouterAddress(
   chainId: number
): Address | null {
   return UNIVERSAL_ROUTER_ADDRESSES[chainId] || null;
}
