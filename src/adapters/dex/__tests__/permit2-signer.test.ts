import { describe, test, expect } from 'bun:test';
import { Address, Hex } from 'viem';
import {
   getPermit2Domain,
   PERMIT_SINGLE_TYPES,
   signPermit2,
   getPermit2Nonce,
} from '../universal-router/permit2-signer.js';
import { PERMIT2_ADDRESS } from '../universal-router/constants.js';

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ROUTER: Address = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const USER: Address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('permit2-signer', () => {
   describe('getPermit2Domain', () => {
      test('returns correct EIP-712 domain for Ethereum mainnet', () => {
         const domain = getPermit2Domain(1);

         expect(domain.name).toBe('Permit2');
         expect(domain.chainId).toBe(1);
         expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
      });

      test('returns correct domain for Base', () => {
         const domain = getPermit2Domain(8453);

         expect(domain.name).toBe('Permit2');
         expect(domain.chainId).toBe(8453);
         // permit2 address is the same on all chains
         expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
      });

      test('returns correct domain for Arbitrum', () => {
         const domain = getPermit2Domain(42161);
         expect(domain.chainId).toBe(42161);
         expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
      });
   });

   describe('PERMIT_SINGLE_TYPES', () => {
      test('has PermitSingle type with correct fields', () => {
         expect(PERMIT_SINGLE_TYPES.PermitSingle).toEqual([
            { name: 'details', type: 'PermitDetails' },
            { name: 'spender', type: 'address' },
            { name: 'sigDeadline', type: 'uint256' },
         ]);
      });

      test('has PermitDetails type with correct fields', () => {
         expect(PERMIT_SINGLE_TYPES.PermitDetails).toEqual([
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' },
         ]);
      });
   });

   describe('signPermit2', () => {
      test('calls signTypedData with correct EIP-712 params', async () => {
         let capturedParams: any = null;
         const mockSignTypedData = async (params: any): Promise<Hex> => {
            capturedParams = params;
            return '0xdeadbeef' as Hex;
         };

         const permit = {
            token: USDC,
            amount: 1000000n,
            expiration: 1700000000,
            nonce: 5,
            spender: ROUTER,
            sigDeadline: 1700003600n,
         };

         const sig = await signPermit2(mockSignTypedData, 1, permit);

         expect(sig).toBe('0xdeadbeef');

         // verify domain
         expect(capturedParams.domain.name).toBe('Permit2');
         expect(capturedParams.domain.chainId).toBe(1);
         expect(capturedParams.domain.verifyingContract).toBe(PERMIT2_ADDRESS);

         // verify types
         expect(capturedParams.types).toBe(PERMIT_SINGLE_TYPES);
         expect(capturedParams.primaryType).toBe('PermitSingle');

         // verify message
         expect(capturedParams.message.details.token).toBe(USDC);
         expect(capturedParams.message.details.amount).toBe(1000000n);
         expect(capturedParams.message.details.expiration).toBe(1700000000n);
         expect(capturedParams.message.details.nonce).toBe(5n);
         expect(capturedParams.message.spender).toBe(ROUTER);
         expect(capturedParams.message.sigDeadline).toBe(1700003600n);
      });

      test('passes through signature from signer', async () => {
         const expectedSig = ('0x' + 'ab'.repeat(65)) as Hex;
         const mockSignTypedData = async (): Promise<Hex> => expectedSig;

         const permit = {
            token: USDC,
            amount: 1000000n,
            expiration: 1700000000,
            nonce: 0,
            spender: ROUTER,
            sigDeadline: 1700003600n,
         };

         const sig = await signPermit2(mockSignTypedData, 1, permit);
         expect(sig).toBe(expectedSig);
      });

      test('propagates signer errors', async () => {
         const mockSignTypedData = async (): Promise<Hex> => {
            throw new Error('user rejected signing');
         };

         const permit = {
            token: USDC,
            amount: 1000000n,
            expiration: 1700000000,
            nonce: 0,
            spender: ROUTER,
            sigDeadline: 1700003600n,
         };

         await expect(
            signPermit2(mockSignTypedData, 1, permit)
         ).rejects.toThrow('user rejected signing');
      });
   });

   describe('getPermit2Nonce', () => {
      test('reads allowance from Permit2 contract', async () => {
         const mockReadContract = async (params: any) => {
            expect(params.address).toBe(PERMIT2_ADDRESS);
            expect(params.functionName).toBe('allowance');
            expect(params.args[0]).toBe(USER);
            expect(params.args[1]).toBe(USDC);
            expect(params.args[2]).toBe(ROUTER);
            return [500000n, 1700086400, 3] as const;
         };

         const result = await getPermit2Nonce(
            mockReadContract,
            USER,
            USDC,
            ROUTER
         );

         expect(result.amount).toBe(500000n);
         expect(result.expiration).toBe(1700086400);
         expect(result.nonce).toBe(3);
      });

      test('returns zero nonce for new token/spender', async () => {
         const mockReadContract = async () => {
            return [0n, 0, 0] as const;
         };

         const result = await getPermit2Nonce(
            mockReadContract,
            USER,
            USDC,
            ROUTER
         );

         expect(result.amount).toBe(0n);
         expect(result.expiration).toBe(0);
         expect(result.nonce).toBe(0);
      });

      test('propagates RPC errors', async () => {
         const mockReadContract = async () => {
            throw new Error('RPC call failed');
         };

         await expect(
            getPermit2Nonce(mockReadContract, USER, USDC, ROUTER)
         ).rejects.toThrow('RPC call failed');
      });
   });
});
