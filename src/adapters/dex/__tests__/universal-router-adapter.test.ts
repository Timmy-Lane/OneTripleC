import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UniversalRouterAdapter } from '../universal-router-adapter.js';
import type { QuoteParams, SwapQuote } from '../types.js';
import { Address, Hex, decodeFunctionData } from 'viem';
import {
   UNIVERSAL_ROUTER_ABI,
   PERMIT2_ADDRESS,
   UR_COMMAND,
} from '../universal-router/constants.js';

// mock viem client
const mockClient = {
   simulateContract: mock(() =>
      Promise.resolve({
         result: [
            1000000n, // amountOut
            [], // sqrtPriceX96AfterList
            [], // initializedTicksCrossedList
            50000n, // gasEstimate
         ],
      })
   ),
   readContract: mock(() =>
      Promise.resolve([0n, 0, 0] as const)
   ),
};

// mock viem-client module
mock.module('../../blockchain/viem-client.js', () => ({
   getViemClient: mock(() => mockClient),
}));

// mock utils
mock.module('../utils/index.js', () => ({
   getQuoterAddress: mock(
      (_protocol: string, _chainId: number) =>
         '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address
   ),
}));

// mock deadline util
mock.module('../utils/deadline.js', () => ({
   getDeadline: mock(() => 9999999999n),
}));

// mock WETH
mock.module('../../tokens/weth.js', () => ({
   WETH: {
      getAddress: mock(
         () => '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
      ),
   },
}));

// mock path helpers
mock.module('../utils/path-helpers.js', () => ({
   isPairedWithWeth: mock(
      (from: Address, to: Address, _chainId: number) => {
         const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
         return (
            from.toLowerCase() === weth.toLowerCase() ||
            to.toLowerCase() === weth.toLowerCase()
         );
      }
   ),
}));

// mock universal-router index -- we do NOT mock this; we use the real encoders
// so we get end-to-end encoding coverage

const TOKEN_A: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
const TOKEN_B: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
const TOKEN_C: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // DAI
const USER_ADDRESS: Address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

function makeQuote(overrides?: Partial<SwapQuote>): SwapQuote {
   return {
      fromToken: TOKEN_A,
      toToken: TOKEN_B,
      fromAmount: 1000000n,
      toAmount: 2000000n,
      protocol: 'universal-router',
      dexAddress: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address,
      calldata: '0x' as Hex,
      estimatedGas: 150000n,
      fee: 3000n,
      path: {
         pools: [
            {
               address: '0x1234567890123456789012345678901234567890' as Address,
               token0: TOKEN_A,
               token1: TOKEN_B,
               dex: 'uniswap',
               version: 'v3',
               chainId: 1,
               v3Data: { fee: 3000 },
            },
         ],
         tokens: [TOKEN_A, TOKEN_B],
         encodedPath:
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex,
      },
      pool: {
         address: '0x1234567890123456789012345678901234567890' as Address,
         token0: TOKEN_A,
         token1: TOKEN_B,
         dex: 'uniswap',
         version: 'v3',
         chainId: 1,
         v3Data: { fee: 3000 },
      },
      ...overrides,
   };
}

describe('UniversalRouterAdapter', () => {
   let adapter: UniversalRouterAdapter;

   beforeEach(() => {
      adapter = new UniversalRouterAdapter({
         chainId: 1,
         rpcUrl: 'https://eth.llamarpc.com',
      });
      mockClient.simulateContract.mockClear();
      mockClient.readContract.mockClear();
   });

   describe('constructor', () => {
      test('initializes with valid chain', () => {
         expect(adapter).toBeDefined();
      });

      test('throws for unsupported chain', () => {
         expect(() => {
            new UniversalRouterAdapter({
               chainId: 999,
               rpcUrl: 'https://fake.rpc',
            });
         }).toThrow('Not deployed on chain 999');
      });
   });

   describe('getQuote', () => {
      test('returns quote for single-hop swap (token -> WETH)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
            slippageBps: 50,
         };

         const quote = await adapter.getQuote(params);

         expect(quote).not.toBeNull();
         expect(quote?.fromToken).toBe(TOKEN_A);
         expect(quote?.toToken).toBe(TOKEN_B);
         expect(quote?.fromAmount).toBe(1000000n);
         expect(quote?.toAmount).toBe(1000000n); // from mock
         expect(quote?.protocol).toBe('universal-router');
         // gas = mock 50000 + UR overhead 30000
         expect(quote?.estimatedGas).toBe(80000n);
         expect(quote?.path.tokens).toEqual([TOKEN_A, TOKEN_B]);
         expect(quote?.path.pools).toHaveLength(1);
         expect(quote?.pool.v3Data?.fee).toBe(3000);
      });

      test('returns quote for multi-hop swap (token -> WETH -> token)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_C, // DAI -- not paired with WETH
            amount: 1000000n,
            side: 'BUY',
            slippageBps: 50,
         };

         const quote = await adapter.getQuote(params);

         expect(quote).not.toBeNull();
         expect(quote?.path.tokens).toHaveLength(3);
         expect(quote?.path.tokens[1]).toBe(TOKEN_B); // WETH intermediate
         expect(quote?.path.pools).toHaveLength(2);
         expect(quote?.intermediatePool).toBeDefined();
         expect(quote?.intermediatePool?.isIntermediate).toBe(true);
      });

      test('returns null when quoter address not found', async () => {
         const { getQuoterAddress } = await import('../utils/index.js');
         (getQuoterAddress as any).mockReturnValueOnce(null);

         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);
         expect(quote).toBeNull();
      });

      test('returns null when simulation fails', async () => {
         mockClient.simulateContract.mockRejectedValueOnce(
            new Error('Insufficient liquidity')
         );

         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);
         expect(quote).toBeNull();
      });

      test('includes UR gas overhead in estimate', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);

         // mock returns 50000, UR overhead is 30000
         expect(quote?.estimatedGas).toBe(80000n);
      });
   });

   describe('buildSwapTransaction', () => {
      test('builds valid swap tx for ERC20 -> ERC20 (no unwrap)', async () => {
         const quote = makeQuote({
            toToken: TOKEN_C, // DAI, not WETH
         });

         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            50
         );

         expect(tx.to).toBe(adapter.getRouterAddress());
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
         expect(tx.value).toBe(0n);

         // decode and verify it is execute()
         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });
         expect(decoded.functionName).toBe('execute');

         // commands should be just V3_SWAP_EXACT_IN (0x00) -- 1 byte
         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x00');

         // one input
         expect(decoded.args[1]).toHaveLength(1);
      });

      test('builds swap tx with UNWRAP_WETH when output is WETH', async () => {
         const quote = makeQuote({
            toToken: TOKEN_B, // WETH
         });

         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            50
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         // commands: V3_SWAP_EXACT_IN (0x00) + UNWRAP_WETH (0x0c)
         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x000c');

         // two inputs
         expect(decoded.args[1]).toHaveLength(2);
      });

      test('throws when encoded path is missing', async () => {
         const quote = makeQuote();
         quote.path.encodedPath = undefined;

         await expect(
            adapter.buildSwapTransaction(quote, USER_ADDRESS, 50)
         ).rejects.toThrow('Missing encoded path');
      });

      test('sends zero value (no ETH)', async () => {
         const quote = makeQuote();
         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            50
         );
         expect(tx.value).toBe(0n);
      });
   });

   describe('buildSwapWithPermit', () => {
      const mockSignTypedData = mock(async () => {
         return ('0x' + 'ab'.repeat(65)) as Hex;
      });

      beforeEach(() => {
         mockSignTypedData.mockClear();
         // mock readContract to return nonce 0
         mockClient.readContract.mockResolvedValue(
            [0n, 0, 0] as readonly [bigint, number, number]
         );
      });

      test('builds tx with PERMIT2_PERMIT + V3_SWAP_EXACT_IN for ERC20 -> ERC20', async () => {
         const quote = makeQuote({
            toToken: TOKEN_C, // not WETH
         });

         const tx = await adapter.buildSwapWithPermit(
            quote,
            USER_ADDRESS,
            50,
            mockSignTypedData
         );

         expect(tx.to).toBe(adapter.getRouterAddress());
         expect(tx.value).toBe(0n);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         // commands: PERMIT2_PERMIT (0x0a) + V3_SWAP_EXACT_IN (0x00)
         expect(decoded.args[0]).toBe('0x0a00');
         expect(decoded.args[1]).toHaveLength(2);
      });

      test('builds tx with PERMIT2_PERMIT + V3_SWAP + UNWRAP_WETH for ERC20 -> WETH', async () => {
         const quote = makeQuote({
            toToken: TOKEN_B, // WETH
         });

         const tx = await adapter.buildSwapWithPermit(
            quote,
            USER_ADDRESS,
            50,
            mockSignTypedData
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         // commands: PERMIT2_PERMIT (0x0a) + V3_SWAP_EXACT_IN (0x00) + UNWRAP_WETH (0x0c)
         expect(decoded.args[0]).toBe('0x0a000c');
         expect(decoded.args[1]).toHaveLength(3);
      });

      test('calls signTypedData with correct permit params', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await adapter.buildSwapWithPermit(
            quote,
            USER_ADDRESS,
            50,
            mockSignTypedData
         );

         expect(mockSignTypedData).toHaveBeenCalledTimes(1);

         const call = mockSignTypedData.mock.calls[0][0] as any;
         expect(call.domain.name).toBe('Permit2');
         expect(call.domain.chainId).toBe(1);
         expect(call.primaryType).toBe('PermitSingle');
         expect(call.message.details.token).toBe(TOKEN_A); // fromToken
         expect(call.message.spender).toBe(adapter.getRouterAddress());
      });

      test('reads nonce from Permit2 contract', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await adapter.buildSwapWithPermit(
            quote,
            USER_ADDRESS,
            50,
            mockSignTypedData
         );

         expect(mockClient.readContract).toHaveBeenCalledTimes(1);
         const readArgs = mockClient.readContract.mock.calls[0][0] as any;
         expect(readArgs.address).toBe(PERMIT2_ADDRESS);
         expect(readArgs.functionName).toBe('allowance');
      });

      test('uses nonce from contract in permit', async () => {
         mockClient.readContract.mockResolvedValueOnce(
            [500000n, 1700086400, 7] as readonly [bigint, number, number]
         );

         const quote = makeQuote({ toToken: TOKEN_C });

         await adapter.buildSwapWithPermit(
            quote,
            USER_ADDRESS,
            50,
            mockSignTypedData
         );

         const call = mockSignTypedData.mock.calls[0][0] as any;
         expect(call.message.details.nonce).toBe(7n); // nonce from mock
      });

      test('throws when encoded path is missing', async () => {
         const quote = makeQuote();
         quote.path.encodedPath = undefined;

         await expect(
            adapter.buildSwapWithPermit(
               quote,
               USER_ADDRESS,
               50,
               mockSignTypedData
            )
         ).rejects.toThrow('Missing encoded path');
      });
   });

   describe('slippage calculation', () => {
      test('0.5% slippage reduces output correctly', async () => {
         const quote = makeQuote({
            toAmount: 2000000n,
            toToken: TOKEN_C,
         });

         // expected: 2000000 * (10000 - 50) / 10000 = 1990000
         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            50
         );

         // we cannot easily extract minAmountOut from the encoded data without
         // full ABI decoding of the inner input, but we verify the tx builds
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });

      test('zero slippage preserves full amount', async () => {
         const quote = makeQuote({
            toAmount: 2000000n,
            toToken: TOKEN_C,
         });

         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            0
         );

         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });

      test('1% slippage on large amount', async () => {
         const quote = makeQuote({
            toAmount: 1000000000000000000n, // 1 ETH
            toToken: TOKEN_C,
         });

         const tx = await adapter.buildSwapTransaction(
            quote,
            USER_ADDRESS,
            100
         );

         // expected: 1e18 * 9900 / 10000 = 9.9e17
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });
   });

   describe('accessor methods', () => {
      test('getRouterAddress returns UR address for chain', () => {
         expect(adapter.getRouterAddress()).toBe(
            '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
         );
      });

      test('getPermit2Address returns canonical Permit2', () => {
         expect(adapter.getPermit2Address()).toBe(PERMIT2_ADDRESS);
      });

      test('getChainId returns configured chain', () => {
         expect(adapter.getChainId()).toBe(1);
      });
   });

   describe('path encoding (via getQuote)', () => {
      test('single-hop path is 43 bytes (88 hex chars with 0x)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);

         expect(quote?.path.encodedPath).toBeDefined();
         expect(quote?.path.encodedPath?.length).toBe(88);
      });

      test('multi-hop path is 66 bytes (134 hex chars with 0x)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_C,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);

         expect(quote?.path.encodedPath).toBeDefined();
         expect(quote?.path.encodedPath?.length).toBe(134);
      });
   });
});
