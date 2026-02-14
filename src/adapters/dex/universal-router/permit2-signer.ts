import { Address, Hex } from 'viem';
import { PERMIT2_ADDRESS, PERMIT2_ABI } from './constants.js';
import type { Permit2PermitParams } from './types.js';

// eip-712 domain for Permit2 (same contract on all chains)
export function getPermit2Domain(chainId: number) {
   return {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
   } as const;
}

// eip-712 types for PermitSingle message
export const PERMIT_SINGLE_TYPES = {
   PermitSingle: [
      { name: 'details', type: 'PermitDetails' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
   ],
   PermitDetails: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
   ],
} as const;

// sign a Permit2 PermitSingle message using EIP-712 typed data
// returns the raw signature bytes
export async function signPermit2(
   signTypedData: (params: {
      domain: ReturnType<typeof getPermit2Domain>;
      types: typeof PERMIT_SINGLE_TYPES;
      primaryType: 'PermitSingle';
      message: {
         details: {
            token: Address;
            amount: bigint;
            expiration: bigint;
            nonce: bigint;
         };
         spender: Address;
         sigDeadline: bigint;
      };
   }) => Promise<Hex>,
   chainId: number,
   permit: Permit2PermitParams
): Promise<Hex> {
   const domain = getPermit2Domain(chainId);

   const message = {
      details: {
         token: permit.token,
         amount: permit.amount,
         expiration: BigInt(permit.expiration),
         nonce: BigInt(permit.nonce),
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
   };

   return signTypedData({
      domain,
      types: PERMIT_SINGLE_TYPES,
      primaryType: 'PermitSingle',
      message,
   });
}

// read the current allowance (amount, expiration, nonce) from Permit2 contract
// nonce is what you need to build the next permit signature
export async function getPermit2Nonce(
   readContract: (params: {
      address: Address;
      abi: typeof PERMIT2_ABI;
      functionName: 'allowance';
      args: [Address, Address, Address];
   }) => Promise<readonly [bigint, number, number]>,
   owner: Address,
   token: Address,
   spender: Address
): Promise<{ amount: bigint; expiration: number; nonce: number }> {
   const result = await readContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [owner, token, spender],
   });

   return {
      amount: result[0],
      expiration: Number(result[1]),
      nonce: Number(result[2]),
   };
}
