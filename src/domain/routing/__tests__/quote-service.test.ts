import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Address, Hex } from 'viem';
import type { SwapQuote as InternalSwapQuote } from '../../../adapters/dex/types.js';

// -- mocks --

const mockURGetQuote = mock(() =>
   Promise.resolve(null as InternalSwapQuote | null)
);
const mockURBuildSwap = mock(() =>
   Promise.resolve({ to: '0x' as Address, data: '0x' as Hex, value: 0n })
);

mock.module('../../../adapters/dex/universal-router-adapter.js', () => ({
   UniversalRouterAdapter: class {
      getQuote = mockURGetQuote;
      buildSwapTransaction = mockURBuildSwap;
   },
}));

mock.module('../../../adapters/dex/universal-router/constants.js', () => ({
   getUniversalRouterAddress: mock(
      () => '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' as Address
   ),
}));

mock.module('../../../adapters/tokens/weth.js', () => ({
   WETH: {
      getAddress: mock(
         () => '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
      ),
   },
}));

const mockGetGasPrice = mock(() => Promise.resolve(20000000000n)); // 20 gwei
mock.module('../../../adapters/blockchain/viem-client.js', () => ({
   getViemClient: mock(() => ({
      getGasPrice: mockGetGasPrice,
   })),
}));

mock.module('../../../adapters/coingecko/index.js', () => ({
   getNativePriceUsd: mock(() => Promise.resolve(3500.0)),
}));

mock.module('../../../adapters/bridge/across-adapter.js', () => ({
   AcrossAdapter: class {
      getQuote = mock(() => Promise.resolve(null));
   },
}));

mock.module('../../../shared/utils/chain-rpc.js', () => ({
   getRpcUrlForChain: mock(() => 'https://eth.llamarpc.com'),
}));

import { QuoteService, createQuoteService } from '../quote-service.js';
import type { QuoteRequest } from '../quote-service.js';
import { RouteStepType } from '../../../shared/types/quote.js';

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH_ADDR: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

function makeInternalQuote(
   overrides?: Partial<InternalSwapQuote>
): InternalSwapQuote {
   return {
      fromToken: USDC,
      toToken: WETH_ADDR,
      fromAmount: 1000000n,
      toAmount: 500000000000000n,
      protocol: 'universal-router',
      dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
      calldata: '0xabcdef' as Hex,
      estimatedGas: 150000n,
      fee: 3000n,
      path: {
         pools: [
            {
               address: '0x1234567890123456789012345678901234567890' as Address,
               token0: USDC,
               token1: WETH_ADDR,
               dex: 'uniswap',
               version: 'v3',
               chainId: 1,
               v3Data: { fee: 3000 },
            },
         ],
         tokens: [USDC, WETH_ADDR],
         encodedPath: '0xabc' as Hex,
      },
      pool: {
         address: '0x1234567890123456789012345678901234567890' as Address,
         token0: USDC,
         token1: WETH_ADDR,
         dex: 'uniswap',
         version: 'v3',
         chainId: 1,
         v3Data: { fee: 3000 },
      },
      ...overrides,
   };
}

describe('QuoteService', () => {
   let service: QuoteService;

   const baseRequest: QuoteRequest = {
      sourceChainId: 1,
      targetChainId: 1,
      sourceToken: USDC,
      targetToken: WETH_ADDR,
      sourceAmount: '1000000',
      slippageBps: 50,
   };

   beforeEach(() => {
      service = createQuoteService();
      mockURGetQuote.mockReset();
      mockURGetQuote.mockResolvedValue(null);
      mockGetGasPrice.mockClear();
   });

   describe('fetchQuotes (same-chain)', () => {
      test('returns empty array when all adapters return null', async () => {
         const results = await service.fetchQuotes(baseRequest);

         expect(results).toEqual([]);
      });

      test('returns quote from universal router adapter', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(1);
         expect(results[0].estimatedOutput).toBe(
            internalQuote.toAmount.toString()
         );
         expect(results[0].route.provider).toBe('universal-router');
      });

      test('returns empty when adapter fails', async () => {
         mockURGetQuote.mockRejectedValueOnce(new Error('RPC timeout'));

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(0);
      });

      test('includes APPROVE step for ERC20 tokens', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(1);
         const steps = results[0].route.steps;
         expect(steps[0].type).toBe(RouteStepType.APPROVE);
         expect(steps[1].type).toBe(RouteStepType.SWAP);
      });

      test('skips APPROVE step for zero address (native token)', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const nativeRequest: QuoteRequest = {
            ...baseRequest,
            sourceToken: '0x0000000000000000000000000000000000000000',
         };

         const results = await service.fetchQuotes(nativeRequest);

         expect(results).toHaveLength(1);
         const steps = results[0].route.steps;
         expect(steps).toHaveLength(1);
         expect(steps[0].type).toBe(RouteStepType.SWAP);
      });

      test('calculates gas fee in wei', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
            estimatedGas: 200000n,
            fee: 3000n,
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(1);
         // totalFee = 200000 * 20e9 + 3000 = 4000000000003000
         const expected = (200000n * 20000000000n + 3000n).toString();
         expect(results[0].totalFee).toBe(expected);
      });

      test('calculates USD fee using native price', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
            estimatedGas: 200000n,
            fee: 0n,
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(1);
         expect(results[0].totalFeeUsd).toBeDefined();
         // 200000 * 20 gwei = 0.004 ETH * $3500 = $14.00
         expect(results[0].totalFeeUsd).toBe('14.00');
      });

      test('sets slippageBps from request', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const request: QuoteRequest = { ...baseRequest, slippageBps: 100 };
         const results = await service.fetchQuotes(request);

         expect(results[0].route.slippageBps).toBe(100);
      });

      test('defaults slippageBps to 50 when not provided', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const request: QuoteRequest = { ...baseRequest };
         delete (request as any).slippageBps;
         const results = await service.fetchQuotes(request);

         expect(results[0].route.slippageBps).toBe(50);
      });

      test('includes fee breakdown in route', async () => {
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
            estimatedGas: 150000n,
            fee: 3000n,
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results[0].route.fees.gasEstimate).toBe('150000');
         expect(results[0].route.fees.dexFee).toBe('3000');
         expect(results[0].route.fees.protocolFee).toBe('0');
         expect(results[0].route.fees.bridgeFee).toBe('0');
      });

      test('falls back to 20 gwei when RPC gas price fails', async () => {
         mockGetGasPrice.mockRejectedValueOnce(new Error('RPC down'));
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
            estimatedGas: 100000n,
            fee: 0n,
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         // fallback 20 gwei * 100000 = 2000000000000000 = 0.002 ETH
         expect(results).toHaveLength(1);
         const expected = (100000n * 20000000000n).toString();
         expect(results[0].totalFee).toBe(expected);
      });

      test('stores encoded path in calldata for universal router quotes', async () => {
         const encodedPath =
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
         const internalQuote = makeInternalQuote({
            protocol: 'universal-router',
            calldata: '0x' as Hex,
            path: {
               pools: [],
               tokens: [USDC, WETH_ADDR],
               encodedPath,
            },
         });
         mockURGetQuote.mockResolvedValueOnce(internalQuote);

         const results = await service.fetchQuotes(baseRequest);

         expect(results).toHaveLength(1);
         const swapStep = results[0].route.steps.find(
            s => s.type === RouteStepType.SWAP
         );
         expect(swapStep?.calldata).toBe(encodedPath);
      });
   });

   describe('createQuoteService', () => {
      test('returns new QuoteService instance', () => {
         const qs = createQuoteService();
         expect(qs).toBeInstanceOf(QuoteService);
      });
   });
});
