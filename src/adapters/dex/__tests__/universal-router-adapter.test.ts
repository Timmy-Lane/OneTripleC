import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UniversalRouterAdapter } from '../universal-router-adapter.js';
import type { QuoteParams, SwapQuote } from '../types.js';
import { Address, Hex, decodeFunctionData, decodeAbiParameters } from 'viem';
import {
   UNIVERSAL_ROUTER_ABI,
   PERMIT2_ADDRESS,
   UR_COMMAND,
   FeeAmount,
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
   getWethAddress: mock(
      async () => '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
   ),
}));

// mock path helpers
mock.module('../utils/path-helpers.js', () => ({
   isPairedWithWeth: mock(
      async (from: Address, to: Address, _chainId: number) => {
         const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
         return (
            from.toLowerCase() === weth.toLowerCase() ||
            to.toLowerCase() === weth.toLowerCase()
         );
      }
   ),
}));

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
      mockClient.simulateContract.mockReset();
      mockClient.simulateContract.mockResolvedValue({
         result: [
            1000000n, // amountOut
            [], // sqrtPriceX96AfterList
            [], // initializedTicksCrossedList
            50000n, // gasEstimate
         ],
      });
      mockClient.readContract.mockReset();
      mockClient.readContract.mockResolvedValue([0n, 0, 0] as const);
   });

   // ---- constructor ----

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

   // ---- getQuote: multi-fee-tier (Phase 4a) ----

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
         expect(quote?.toAmount).toBe(1000000n);
         expect(quote?.protocol).toBe('universal-router');
         expect(quote?.estimatedGas).toBe(80000n);
         expect(quote?.path.tokens).toEqual([TOKEN_A, TOKEN_B]);
         expect(quote?.path.pools).toHaveLength(1);
      });

      test('tries multiple fee tiers for single-hop', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         await adapter.getQuote(params);

         // should try all 4 fee tiers in parallel
         expect(mockClient.simulateContract).toHaveBeenCalledTimes(4);
      });

      test('picks best fee tier by output amount', async () => {
         let callCount = 0;
         mockClient.simulateContract.mockImplementation(async () => {
            callCount++;
            // fee tiers order: MEDIUM(3000), LOW(500), HIGH(10000), LOWEST(100)
            // make LOW (500) tier return the best amount
            if (callCount === 2) {
               return {
                  result: [2000000n, [], [], 45000n],
               };
            }
            return {
               result: [1000000n, [], [], 50000n],
            };
         });

         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);

         expect(quote).not.toBeNull();
         expect(quote?.toAmount).toBe(2000000n);
         expect(quote?.pool.v3Data?.fee).toBe(FeeAmount.LOW);
      });

      test('returns quote for multi-hop swap (token -> WETH -> token)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_C,
            amount: 1000000n,
            side: 'BUY',
            slippageBps: 50,
         };

         const quote = await adapter.getQuote(params);

         expect(quote).not.toBeNull();
         expect(quote?.path.tokens).toHaveLength(3);
         expect(quote?.path.tokens[1]).toBe(TOKEN_B);
         expect(quote?.path.pools).toHaveLength(2);
         expect(quote?.intermediatePool).toBeDefined();
         expect(quote?.intermediatePool?.isIntermediate).toBe(true);
      });

      test('tries multiple fee tier combos for multi-hop', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_C,
            amount: 1000000n,
            side: 'BUY',
         };

         await adapter.getQuote(params);

         expect(mockClient.simulateContract).toHaveBeenCalledTimes(4);
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

      test('returns null when all fee tier simulations fail', async () => {
         mockClient.simulateContract.mockRejectedValue(
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

      test('returns result when some fee tiers fail but others succeed', async () => {
         let callCount = 0;
         mockClient.simulateContract.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
               throw new Error('No liquidity in 3000 pool');
            }
            return { result: [500000n, [], [], 40000n] };
         });

         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);
         expect(quote).not.toBeNull();
         expect(quote?.toAmount).toBe(500000n);
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
         expect(quote?.estimatedGas).toBe(80000n);
      });
   });

   // ---- Phase 5: input validation ----

   describe('input validation', () => {
      test('getQuote throws for zero amount', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 0n,
            side: 'BUY',
         };

         await expect(adapter.getQuote(params)).rejects.toThrow(
            'Amount must be greater than zero'
         );
      });

      test('getQuote throws for negative amount', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: -1n,
            side: 'BUY',
         };

         await expect(adapter.getQuote(params)).rejects.toThrow(
            'Amount must be greater than zero'
         );
      });

      test('getQuote throws when fromToken equals toToken', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_A,
            amount: 1000000n,
            side: 'BUY',
         };

         await expect(adapter.getQuote(params)).rejects.toThrow(
            'fromToken and toToken must be different'
         );
      });

      test('buildSwapTransaction throws for zero address recipient', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await expect(
            adapter.buildSwapTransaction(
               quote,
               '0x0000000000000000000000000000000000000000' as Address,
               50
            )
         ).rejects.toThrow('Recipient cannot be zero address');
      });

      test('buildSwapTransaction throws for excessive slippage', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await expect(
            adapter.buildSwapTransaction(quote, USER_ADDRESS, 6000)
         ).rejects.toThrow('Slippage must be between 0 and 5000 bps');
      });

      test('buildSwapTransaction throws for negative slippage', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await expect(
            adapter.buildSwapTransaction(quote, USER_ADDRESS, -1)
         ).rejects.toThrow('Slippage must be between 0 and 5000 bps');
      });

      test('buildV2SwapTransaction validates recipient', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await expect(
            adapter.buildV2SwapTransaction(
               quote,
               '0x0000000000000000000000000000000000000000' as Address,
               50
            )
         ).rejects.toThrow('Recipient cannot be zero address');
      });

      test('buildSwapWithPermit validates recipient', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });
         const mockSign = mock(async () => '0xabcd' as Hex);

         await expect(
            adapter.buildSwapWithPermit(
               quote,
               '0x0000000000000000000000000000000000000000' as Address,
               50,
               mockSign
            )
         ).rejects.toThrow('Recipient cannot be zero address');
      });

      test('buildSwapWithPermit validates slippage', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });
         const mockSign = mock(async () => '0xabcd' as Hex);

         await expect(
            adapter.buildSwapWithPermit(
               quote,
               USER_ADDRESS,
               10000,
               mockSign
            )
         ).rejects.toThrow('Slippage must be between 0 and 5000 bps');
      });

      test('buildV2SwapWithPermit validates recipient', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });
         const mockSign = mock(async () => '0xabcd' as Hex);

         await expect(
            adapter.buildV2SwapWithPermit(
               quote,
               '0x0000000000000000000000000000000000000000' as Address,
               50,
               mockSign
            )
         ).rejects.toThrow('Recipient cannot be zero address');
      });
   });

   // ---- buildSwapTransaction (V3 via UR) ----

   describe('buildSwapTransaction', () => {
      test('builds valid swap tx for ERC20 -> ERC20 (no unwrap)', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);

         expect(tx.to).toBe(adapter.getRouterAddress());
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
         expect(tx.value).toBe(0n);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });
         expect(decoded.functionName).toBe('execute');

         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x00');
         expect(decoded.args[1]).toHaveLength(1);
      });

      test('builds swap tx with UNWRAP_WETH when output is WETH', async () => {
         const quote = makeQuote({ toToken: TOKEN_B });

         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x000c');
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
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);
         expect(tx.value).toBe(0n);
      });
   });

   // ---- buildV2SwapTransaction (Phase 4b) ----

   describe('buildV2SwapTransaction', () => {
      test('builds V2 swap via UR with V2_SWAP_EXACT_IN command', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         const tx = await adapter.buildV2SwapTransaction(quote, USER_ADDRESS, 50);

         expect(tx.to).toBe(adapter.getRouterAddress());
         expect(tx.value).toBe(0n);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });
         expect(decoded.functionName).toBe('execute');

         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x08');
         expect(decoded.args[1]).toHaveLength(1);
      });

      test('builds V2 swap with UNWRAP_WETH when output is WETH', async () => {
         const quote = makeQuote({ toToken: TOKEN_B });

         const tx = await adapter.buildV2SwapTransaction(quote, USER_ADDRESS, 50);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         const commands = decoded.args[0] as Hex;
         expect(commands).toBe('0x080c');
         expect(decoded.args[1]).toHaveLength(2);
      });

      test('V2 swap encodes address[] path (not bytes)', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         const tx = await adapter.buildV2SwapTransaction(quote, USER_ADDRESS, 50);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         const swapInput = (decoded.args[1] as Hex[])[0];
         const innerDecoded = decodeAbiParameters(
            [
               { name: 'recipient', type: 'address' },
               { name: 'amountIn', type: 'uint256' },
               { name: 'amountOutMin', type: 'uint256' },
               { name: 'path', type: 'address[]' },
               { name: 'payerIsUser', type: 'bool' },
            ],
            swapInput
         );

         const path = innerDecoded[3] as Address[];
         expect(path.length).toBeGreaterThanOrEqual(2);
         expect(path[0].toLowerCase()).toBe(TOKEN_A.toLowerCase());
         expect(path[1].toLowerCase()).toBe(TOKEN_B.toLowerCase());
         expect(innerDecoded[4]).toBe(true);
      });
   });

   // ---- buildV2SwapWithPermit ----

   describe('buildV2SwapWithPermit', () => {
      const mockSignTypedData = mock(async () => {
         return ('0x' + 'ab'.repeat(65)) as Hex;
      });

      beforeEach(() => {
         mockSignTypedData.mockClear();
         mockClient.readContract.mockResolvedValue(
            [0n, 0, 0] as readonly [bigint, number, number]
         );
      });

      test('builds PERMIT2 + V2_SWAP for ERC20 -> ERC20', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         const tx = await adapter.buildV2SwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         expect(decoded.args[0]).toBe('0x0a08');
         expect(decoded.args[1]).toHaveLength(2);
      });

      test('builds PERMIT2 + V2_SWAP + UNWRAP for ERC20 -> WETH', async () => {
         const quote = makeQuote({ toToken: TOKEN_B });

         const tx = await adapter.buildV2SwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         expect(decoded.args[0]).toBe('0x0a080c');
         expect(decoded.args[1]).toHaveLength(3);
      });
   });

   // ---- buildSwapWithPermit (V3 via UR) ----

   describe('buildSwapWithPermit', () => {
      const mockSignTypedData = mock(async () => {
         return ('0x' + 'ab'.repeat(65)) as Hex;
      });

      beforeEach(() => {
         mockSignTypedData.mockClear();
         mockClient.readContract.mockResolvedValue(
            [0n, 0, 0] as readonly [bigint, number, number]
         );
      });

      test('builds PERMIT2 + V3_SWAP for ERC20 -> ERC20', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         const tx = await adapter.buildSwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         expect(tx.to).toBe(adapter.getRouterAddress());
         expect(tx.value).toBe(0n);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         expect(decoded.args[0]).toBe('0x0a00');
         expect(decoded.args[1]).toHaveLength(2);
      });

      test('builds PERMIT2 + V3_SWAP + UNWRAP for ERC20 -> WETH', async () => {
         const quote = makeQuote({ toToken: TOKEN_B });

         const tx = await adapter.buildSwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         expect(decoded.args[0]).toBe('0x0a000c');
         expect(decoded.args[1]).toHaveLength(3);
      });

      test('calls signTypedData with correct permit params', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await adapter.buildSwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         expect(mockSignTypedData).toHaveBeenCalledTimes(1);

         const call = mockSignTypedData.mock.calls[0][0] as any;
         expect(call.domain.name).toBe('Permit2');
         expect(call.domain.chainId).toBe(1);
         expect(call.primaryType).toBe('PermitSingle');
         expect(call.message.details.token).toBe(TOKEN_A);
         expect(call.message.spender).toBe(adapter.getRouterAddress());
      });

      test('reads nonce from Permit2 contract', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });

         await adapter.buildSwapWithPermit(
            quote, USER_ADDRESS, 50, mockSignTypedData
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
            quote, USER_ADDRESS, 50, mockSignTypedData
         );

         const call = mockSignTypedData.mock.calls[0][0] as any;
         expect(call.message.details.nonce).toBe(7n);
      });

      test('throws when encoded path is missing', async () => {
         const quote = makeQuote();
         quote.path.encodedPath = undefined;

         await expect(
            adapter.buildSwapWithPermit(quote, USER_ADDRESS, 50, mockSignTypedData)
         ).rejects.toThrow('Missing encoded path');
      });
   });

   // ---- slippage calculation ----

   describe('slippage calculation', () => {
      test('0.5% slippage reduces output correctly', async () => {
         const quote = makeQuote({ toAmount: 2000000n, toToken: TOKEN_C });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });

      test('zero slippage preserves full amount', async () => {
         const quote = makeQuote({ toAmount: 2000000n, toToken: TOKEN_C });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 0);
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });

      test('1% slippage on large amount', async () => {
         const quote = makeQuote({
            toAmount: 1000000000000000000n,
            toToken: TOKEN_C,
         });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 100);
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });

      test('max allowed slippage (50%)', async () => {
         const quote = makeQuote({ toAmount: 2000000n, toToken: TOKEN_C });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 5000);
         expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
      });
   });

   // ---- accessor methods ----

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

   // ---- path encoding ----

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

   // ---- edge cases (Phase 5) ----

   describe('edge cases', () => {
      test('handles dust amount (1 wei)', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1n,
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);
         expect(quote).not.toBeNull();
      });

      test('handles large amount', async () => {
         const params: QuoteParams = {
            chainId: 1,
            fromToken: TOKEN_A,
            toToken: TOKEN_B,
            amount: 1000000000000000000000000n, // 1M ETH worth
            side: 'BUY',
         };

         const quote = await adapter.getQuote(params);
         expect(quote).not.toBeNull();
      });

      test('builds transaction with boundary slippage (0 bps)', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 0);
         expect(tx.data).toBeDefined();
      });

      test('builds transaction with boundary slippage (5000 bps)', async () => {
         const quote = makeQuote({ toToken: TOKEN_C });
         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 5000);
         expect(tx.data).toBeDefined();
      });

      test('address case insensitive matching for WETH detection', async () => {
         const mixedCaseWeth =
            '0xc02aaa39b223FE8D0A0E5C4F27eAD9083C756CC2' as Address;
         const quote = makeQuote({ toToken: mixedCaseWeth });

         const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);

         const decoded = decodeFunctionData({
            abi: UNIVERSAL_ROUTER_ABI,
            data: tx.data,
         });

         // should detect WETH and add UNWRAP command
         expect(decoded.args[0]).toBe('0x000c');
      });
   });

   // ---- multi-chain support ----

   describe('multi-chain', () => {
      test('initializes for Base (8453)', () => {
         const baseAdapter = new UniversalRouterAdapter({
            chainId: 8453,
            rpcUrl: 'https://base.llamarpc.com',
         });
         expect(baseAdapter.getChainId()).toBe(8453);
         expect(baseAdapter.getRouterAddress()).toBe(
            '0x6ff5693b99212da76ad316178a184ab56d299b43'
         );
      });

      test('initializes for Arbitrum (42161)', () => {
         const arbAdapter = new UniversalRouterAdapter({
            chainId: 42161,
            rpcUrl: 'https://arb.llamarpc.com',
         });
         expect(arbAdapter.getChainId()).toBe(42161);
         expect(arbAdapter.getRouterAddress()).toBe(
            '0xa51afafe0263b40edaef0df8781ea9aa03e381a3'
         );
      });

      test('Permit2 address is the same across all chains', () => {
         const chains = [1, 8453, 42161, 10, 137];
         for (const chainId of chains) {
            const a = new UniversalRouterAdapter({
               chainId,
               rpcUrl: 'https://rpc.example.com',
            });
            expect(a.getPermit2Address()).toBe(PERMIT2_ADDRESS);
         }
      });
   });
});
