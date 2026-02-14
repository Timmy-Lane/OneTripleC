import { describe, test, expect } from 'bun:test';
import { decodeAbiParameters, decodeFunctionData, Address, Hex } from 'viem';
import {
   encodeCommand,
   encodeCommands,
   encodeV3SwapExactIn,
   encodeV2SwapExactIn,
   encodeWrapEth,
   encodeUnwrapWeth,
   encodeSweep,
   encodePermit2Permit,
   encodeExecute,
} from '../universal-router/command-encoder.js';
import {
   UR_COMMAND,
   FLAG_ALLOW_REVERT,
   UNIVERSAL_ROUTER_ABI,
} from '../universal-router/constants.js';

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USER: Address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const ROUTER: Address = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';

describe('command-encoder', () => {
   describe('encodeCommand', () => {
      test('encodes V3_SWAP_EXACT_IN without allow-revert', () => {
         const cmd = encodeCommand(UR_COMMAND.V3_SWAP_EXACT_IN);
         expect(cmd).toBe('0x00');
      });

      test('encodes V3_SWAP_EXACT_IN with allow-revert', () => {
         const cmd = encodeCommand(UR_COMMAND.V3_SWAP_EXACT_IN, true);
         expect(cmd).toBe('0x80');
      });

      test('encodes PERMIT2_PERMIT', () => {
         const cmd = encodeCommand(UR_COMMAND.PERMIT2_PERMIT);
         expect(cmd).toBe('0x0a');
      });

      test('encodes UNWRAP_WETH', () => {
         const cmd = encodeCommand(UR_COMMAND.UNWRAP_WETH);
         expect(cmd).toBe('0x0c');
      });

      test('encodes SWEEP', () => {
         const cmd = encodeCommand(UR_COMMAND.SWEEP);
         expect(cmd).toBe('0x04');
      });

      test('encodes V2_SWAP_EXACT_IN', () => {
         const cmd = encodeCommand(UR_COMMAND.V2_SWAP_EXACT_IN);
         expect(cmd).toBe('0x08');
      });

      test('encodes WRAP_ETH', () => {
         const cmd = encodeCommand(UR_COMMAND.WRAP_ETH);
         expect(cmd).toBe('0x0b');
      });

      test('allow-revert sets 0x80 flag on any command', () => {
         const cmd = encodeCommand(UR_COMMAND.UNWRAP_WETH, true);
         // 0x0c | 0x80 = 0x8c
         expect(cmd).toBe('0x8c');
      });
   });

   describe('encodeCommands', () => {
      test('encodes single command', () => {
         const result = encodeCommands([{ id: UR_COMMAND.V3_SWAP_EXACT_IN }]);
         expect(result).toBe('0x00');
      });

      test('encodes permit + swap + unwrap', () => {
         const result = encodeCommands([
            { id: UR_COMMAND.PERMIT2_PERMIT },
            { id: UR_COMMAND.V3_SWAP_EXACT_IN },
            { id: UR_COMMAND.UNWRAP_WETH },
         ]);
         // 0x0a, 0x00, 0x0c
         expect(result).toBe('0x0a000c');
      });

      test('encodes commands with mixed allow-revert flags', () => {
         const result = encodeCommands([
            { id: UR_COMMAND.V3_SWAP_EXACT_IN, allowRevert: false },
            { id: UR_COMMAND.SWEEP, allowRevert: true },
         ]);
         // 0x00, 0x84 (0x04 | 0x80)
         expect(result).toBe('0x0084');
      });

      test('encodes swap-only (no permit)', () => {
         const result = encodeCommands([
            { id: UR_COMMAND.V3_SWAP_EXACT_IN },
         ]);
         expect(result).toBe('0x00');
      });

      test('encodes V2 swap', () => {
         const result = encodeCommands([
            { id: UR_COMMAND.V2_SWAP_EXACT_IN },
         ]);
         expect(result).toBe('0x08');
      });
   });

   describe('encodeV3SwapExactIn', () => {
      test('returns valid ABI-encoded hex', () => {
         const path = '0xabcdef' as Hex;
         const encoded = encodeV3SwapExactIn({
            recipient: USER,
            amountIn: 1000000n,
            amountOutMin: 990000n,
            path,
            payerIsUser: true,
         });

         expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

         // decode and verify
         const decoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amountIn', type: 'uint256' },
               { name: 'amountOutMin', type: 'uint256' },
               { name: 'path', type: 'bytes' },
               { name: 'payerIsUser', type: 'bool' },
            ],
            encoded
         );

         expect(decoded[0].toLowerCase()).toBe(USER.toLowerCase());
         expect(decoded[1]).toBe(1000000n);
         expect(decoded[2]).toBe(990000n);
         expect(decoded[3].toLowerCase()).toBe(path.toLowerCase());
         expect(decoded[4]).toBe(true);
      });

      test('encodes payerIsUser false', () => {
         const encoded = encodeV3SwapExactIn({
            recipient: USER,
            amountIn: 1000000n,
            amountOutMin: 0n,
            path: '0xabcdef' as Hex,
            payerIsUser: false,
         });

         const decoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amountIn', type: 'uint256' },
               { name: 'amountOutMin', type: 'uint256' },
               { name: 'path', type: 'bytes' },
               { name: 'payerIsUser', type: 'bool' },
            ],
            encoded
         );

         expect(decoded[4]).toBe(false);
      });
   });

   describe('encodeV2SwapExactIn', () => {
      test('returns valid ABI-encoded hex with address array', () => {
         const encoded = encodeV2SwapExactIn({
            recipient: USER,
            amountIn: 5000000n,
            amountOutMin: 4950000n,
            path: [USDC, WETH],
            payerIsUser: true,
         });

         expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

         const decoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amountIn', type: 'uint256' },
               { name: 'amountOutMin', type: 'uint256' },
               { name: 'path', type: 'address[]' },
               { name: 'payerIsUser', type: 'bool' },
            ],
            encoded
         );

         expect(decoded[0].toLowerCase()).toBe(USER.toLowerCase());
         expect(decoded[1]).toBe(5000000n);
         expect(decoded[2]).toBe(4950000n);
         expect(decoded[3].length).toBe(2);
         expect(decoded[3][0].toLowerCase()).toBe(USDC.toLowerCase());
         expect(decoded[3][1].toLowerCase()).toBe(WETH.toLowerCase());
         expect(decoded[4]).toBe(true);
      });
   });

   describe('encodeWrapEth', () => {
      test('returns valid ABI-encoded hex', () => {
         const encoded = encodeWrapEth({
            recipient: USER,
            amount: 1000000000000000000n, // 1 ETH
         });

         const decoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amount', type: 'uint256' },
            ],
            encoded
         );

         expect(decoded[0].toLowerCase()).toBe(USER.toLowerCase());
         expect(decoded[1]).toBe(1000000000000000000n);
      });
   });

   describe('encodeUnwrapWeth', () => {
      test('returns valid ABI-encoded hex', () => {
         const encoded = encodeUnwrapWeth({
            recipient: USER,
            amountMin: 990000n,
         });

         const decoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amountMin', type: 'uint256' },
            ],
            encoded
         );

         expect(decoded[0].toLowerCase()).toBe(USER.toLowerCase());
         expect(decoded[1]).toBe(990000n);
      });
   });

   describe('encodeSweep', () => {
      test('returns valid ABI-encoded hex', () => {
         const encoded = encodeSweep({
            token: USDC,
            recipient: USER,
            amountMin: 0n,
         });

         const decoded = decodeAbiParameters(
            [
               { name: 'token', type: 'address' },
               { name: 'recipient', type: 'address' },
               { name: 'amountMin', type: 'uint256' },
            ],
            encoded
         );

         expect(decoded[0].toLowerCase()).toBe(USDC.toLowerCase());
         expect(decoded[1].toLowerCase()).toBe(USER.toLowerCase());
         expect(decoded[2]).toBe(0n);
      });
   });

   describe('encodePermit2Permit', () => {
      test('returns valid ABI-encoded PermitSingle + signature', () => {
         const fakeSig = ('0x' + 'ab'.repeat(65)) as Hex;

         const encoded = encodePermit2Permit(
            {
               token: USDC,
               amount: 1000000n,
               expiration: 1700000000,
               nonce: 0,
               spender: ROUTER,
               sigDeadline: 1700003600n,
            },
            fakeSig
         );

         expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

         // decode the outer tuple
         const decoded = decodeAbiParameters(
            [
               {
                  name: 'permitSingle',
                  type: 'tuple',
                  components: [
                     {
                        name: 'details',
                        type: 'tuple',
                        components: [
                           { name: 'token', type: 'address' },
                           { name: 'amount', type: 'uint160' },
                           { name: 'expiration', type: 'uint48' },
                           { name: 'nonce', type: 'uint48' },
                        ],
                     },
                     { name: 'spender', type: 'address' },
                     { name: 'sigDeadline', type: 'uint256' },
                  ],
               },
               { name: 'signature', type: 'bytes' },
            ],
            encoded
         );

         const permitSingle = decoded[0] as any;
         expect(permitSingle.details.token.toLowerCase()).toBe(USDC.toLowerCase());
         expect(permitSingle.details.amount).toBe(1000000n);
         expect(permitSingle.details.expiration).toBe(1700000000);
         expect(permitSingle.details.nonce).toBe(0);
         expect(permitSingle.spender.toLowerCase()).toBe(ROUTER.toLowerCase());
         expect(permitSingle.sigDeadline).toBe(1700003600n);
         expect((decoded[1] as string).toLowerCase()).toBe(fakeSig.toLowerCase());
      });

      test('handles nonce > 0', () => {
         const fakeSig = ('0x' + 'ff'.repeat(65)) as Hex;

         const encoded = encodePermit2Permit(
            {
               token: WETH,
               amount: 5000000000000000000n,
               expiration: 1700086400,
               nonce: 42,
               spender: ROUTER,
               sigDeadline: 1700090000n,
            },
            fakeSig
         );

         const decoded = decodeAbiParameters(
            [
               {
                  name: 'permitSingle',
                  type: 'tuple',
                  components: [
                     {
                        name: 'details',
                        type: 'tuple',
                        components: [
                           { name: 'token', type: 'address' },
                           { name: 'amount', type: 'uint160' },
                           { name: 'expiration', type: 'uint48' },
                           { name: 'nonce', type: 'uint48' },
                        ],
                     },
                     { name: 'spender', type: 'address' },
                     { name: 'sigDeadline', type: 'uint256' },
                  ],
               },
               { name: 'signature', type: 'bytes' },
            ],
            encoded
         );

         const permitSingle = decoded[0] as any;
         expect(permitSingle.details.nonce).toBe(42);
      });
   });

   describe('encodeExecute', () => {
      test('encodes valid execute() calldata', () => {
         const commands = '0x000c' as Hex; // swap + unwrap
         const swapInput = encodeV3SwapExactIn({
            recipient: USER,
            amountIn: 1000000n,
            amountOutMin: 990000n,
            path: '0xabcdef' as Hex,
            payerIsUser: true,
         });
         const unwrapInput = encodeUnwrapWeth({
            recipient: USER,
            amountMin: 990000n,
         });
         const deadline = 1700000000n;

         const calldata = encodeExecute(commands, [swapInput, unwrapInput], deadline);

         expect(calldata).toMatch(/^0x[a-fA-F0-9]+$/);

         // decode the function data
         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: calldata,
         });

         expect(decoded.functionName).toBe('execute');
         expect(decoded.args[0]).toBe(commands);
         expect(decoded.args[1]).toHaveLength(2);
         expect(decoded.args[2]).toBe(deadline);
      });

      test('encodes execute() with permit + swap + unwrap', () => {
         const commands = '0x0a000c' as Hex;
         const fakeSig = ('0x' + 'ab'.repeat(65)) as Hex;

         const permitInput = encodePermit2Permit(
            {
               token: USDC,
               amount: 1000000n,
               expiration: 1700000000,
               nonce: 0,
               spender: ROUTER,
               sigDeadline: 1700003600n,
            },
            fakeSig
         );
         const swapInput = encodeV3SwapExactIn({
            recipient: ROUTER,
            amountIn: 1000000n,
            amountOutMin: 990000n,
            path: '0xabcdef' as Hex,
            payerIsUser: true,
         });
         const unwrapInput = encodeUnwrapWeth({
            recipient: USER,
            amountMin: 990000n,
         });
         const deadline = 1700003600n;

         const calldata = encodeExecute(
            commands,
            [permitInput, swapInput, unwrapInput],
            deadline
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: calldata,
         });

         expect(decoded.functionName).toBe('execute');
         expect(decoded.args[0]).toBe(commands);
         expect(decoded.args[1]).toHaveLength(3);
         expect(decoded.args[2]).toBe(deadline);
      });
   });
});
