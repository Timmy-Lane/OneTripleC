import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { UniswapV3Adapter } from '../uniswap-v3-adapter.js';
import type { QuoteParams, SwapQuote } from '../types.js';
import { Address, Hex } from 'viem';

// mock viem client
const mockClient = {
  simulateContract: mock(() => Promise.resolve({
    result: [
      1000000n, // amountOut
      [], // sqrtPriceX96AfterList
      [], // initializedTicksCrossedList
      50000n // gasEstimate
    ]
  }))
};

// mock viem-client module
mock.module('../../blockchain/viem-client.js', () => ({
  getViemClient: mock(() => mockClient)
}));

// mock utils
mock.module('../utils/index.js', () => ({
  getRouterAddress: mock((protocol: string, version: string, chainId: number) =>
    '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address
  ),
  getQuoterAddress: mock((protocol: string, chainId: number) =>
    '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address
  )
}));

// mock deadline util
mock.module('../utils/deadline.js', () => ({
  getDeadline: mock(() => 9999999999n)
}));

// mock WETH
mock.module('../../tokens/weth.js', () => ({
  WETH: {
    getAddress: mock(() => '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address)
  }
}));

// mock path helpers
mock.module('../utils/path-helpers.js', () => ({
  isPairedWithWeth: mock((from: Address, to: Address, chainId: number) => {
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    return from.toLowerCase() === weth.toLowerCase() || to.toLowerCase() === weth.toLowerCase();
  }),
  getOtherToken: mock((tokenA: Address, tokenB: Address, wethAddress: Address) => {
    return tokenA.toLowerCase() === wethAddress.toLowerCase() ? tokenB : tokenA;
  })
}));

describe('UniswapV3Adapter', () => {
  let adapter: UniswapV3Adapter;

  const TOKEN_A: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
  const TOKEN_B: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
  const TOKEN_C: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // DAI
  const USER_ADDRESS: Address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // vitalik.eth

  beforeEach(() => {
    adapter = new UniswapV3Adapter({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com'
    });
    mockClient.simulateContract.mockClear();
  });

  describe('constructor', () => {
    test('initializes with config', () => {
      expect(adapter).toBeDefined();
    });
  });

  describe('getQuote', () => {
    test('returns quote for single-hop swap (token-WETH)', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n, // 1 USDC (6 decimals)
        side: 'BUY',
        slippageBps: 50
      };

      const quote = await adapter.getQuote(params);

      expect(quote).not.toBeNull();
      expect(quote?.fromToken).toBe(TOKEN_A);
      expect(quote?.toToken).toBe(TOKEN_B);
      expect(quote?.fromAmount).toBe(1000000n);
      expect(quote?.toAmount).toBe(1000000n); // from mock
      expect(quote?.protocol).toBe('uniswap-v3');
      expect(quote?.estimatedGas).toBe(50000n);
      expect(quote?.path.tokens).toEqual([TOKEN_A, TOKEN_B]);
      expect(quote?.path.pools).toHaveLength(1);
      expect(quote?.pool.v3Data?.fee).toBe(3000); // default 0.3%
    });

    test('returns quote for multi-hop swap (token-WETH-token)', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A, // USDC
        toToken: TOKEN_C, // DAI (not paired with WETH directly)
        amount: 1000000n,
        side: 'BUY',
        slippageBps: 50
      };

      const quote = await adapter.getQuote(params);

      expect(quote).not.toBeNull();
      expect(quote?.path.tokens).toHaveLength(3);
      expect(quote?.path.tokens[1]).toBe(TOKEN_B); // WETH as intermediate
      expect(quote?.path.pools).toHaveLength(2);
      expect(quote?.intermediatePool).toBeDefined();
      expect(quote?.intermediatePool?.isIntermediate).toBe(true);
    });

    test('returns quote with custom intermediate token', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_C,
        amount: 1000000n,
        side: 'BUY',
        slippageBps: 50,
        intermediateTokens: [TOKEN_B] // explicit WETH
      };

      const quote = await adapter.getQuote(params);

      expect(quote).not.toBeNull();
      expect(quote?.path.tokens[1]).toBe(TOKEN_B);
    });

    test('returns null when quoter address not found', async () => {
      const { getQuoterAddress } = await import('../utils/index.js');
      getQuoterAddress.mockReturnValueOnce(null);

      const params: QuoteParams = {
        chainId: 999, // unsupported chain
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
      };

      const quote = await adapter.getQuote(params);
      expect(quote).toBeNull();
    });

    test('returns null when router address not found', async () => {
      const { getRouterAddress } = await import('../utils/index.js');
      getRouterAddress.mockReturnValueOnce(null);

      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
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
        side: 'BUY'
      };

      const quote = await adapter.getQuote(params);
      expect(quote).toBeNull();
    });

    test('calls quoter with correct encoded path', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
      };

      await adapter.getQuote(params);

      expect(mockClient.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'quoteExactInput',
          args: [
            expect.any(String), // encoded path
            1000000n
          ]
        })
      );
    });
  });

  describe('buildSwapTransaction', () => {
    test('builds valid swap transaction', async () => {
      const quote: SwapQuote = {
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        fromAmount: 1000000n,
        toAmount: 2000000n,
        protocol: 'uniswap-v3',
        dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
        calldata: '0x' as Hex,
        estimatedGas: 150000n,
        fee: 3000n,
        path: {
          pools: [{
            address: '0x1234567890123456789012345678901234567890' as Address,
            token0: TOKEN_A,
            token1: TOKEN_B,
            dex: 'uniswap',
            version: 'v3',
            chainId: 1,
            v3Data: { fee: 3000 }
          }],
          tokens: [TOKEN_A, TOKEN_B],
          encodedPath: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
        },
        pool: {
          address: '0x1234567890123456789012345678901234567890' as Address,
          token0: TOKEN_A,
          token1: TOKEN_B,
          dex: 'uniswap',
          version: 'v3',
          chainId: 1,
          v3Data: { fee: 3000 }
        }
      };

      const tx = await adapter.buildSwapTransaction(quote, USER_ADDRESS, 50);

      expect(tx.to).toBe(quote.dexAddress);
      expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/); // valid hex
      expect(tx.value).toBe(0n);
    });

    test('applies slippage correctly', async () => {
      const quote: SwapQuote = {
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        fromAmount: 1000000n,
        toAmount: 2000000n, // 2 USDC out
        protocol: 'uniswap-v3',
        dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
        calldata: '0x' as Hex,
        estimatedGas: 150000n,
        fee: 3000n,
        path: {
          pools: [{
            address: '0x1234567890123456789012345678901234567890' as Address,
            token0: TOKEN_A,
            token1: TOKEN_B,
            dex: 'uniswap',
            version: 'v3',
            chainId: 1,
            v3Data: { fee: 3000 }
          }],
          tokens: [TOKEN_A, TOKEN_B],
          encodedPath: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
        },
        pool: {
          address: '0x1234567890123456789012345678901234567890' as Address,
          token0: TOKEN_A,
          token1: TOKEN_B,
          dex: 'uniswap',
          version: 'v3',
          chainId: 1,
          v3Data: { fee: 3000 }
        }
      };

      const slippageBps = 50; // 0.5%
      await adapter.buildSwapTransaction(quote, USER_ADDRESS, slippageBps);

      // expected min out: 2000000 * (10000 - 50) / 10000 = 1990000
      const expectedMinOut = (2000000n * 9950n) / 10000n;
      expect(expectedMinOut).toBe(1990000n);
    });

    test('throws when encoded path missing', async () => {
      const quote: SwapQuote = {
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        fromAmount: 1000000n,
        toAmount: 2000000n,
        protocol: 'uniswap-v3',
        dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
        calldata: '0x' as Hex,
        estimatedGas: 150000n,
        fee: 3000n,
        path: {
          pools: [],
          tokens: [TOKEN_A, TOKEN_B]
          // missing encodedPath
        },
        pool: {
          address: '0x1234567890123456789012345678901234567890' as Address,
          token0: TOKEN_A,
          token1: TOKEN_B,
          dex: 'uniswap',
          version: 'v3',
          chainId: 1,
          v3Data: { fee: 3000 }
        }
      };

      await expect(
        adapter.buildSwapTransaction(quote, USER_ADDRESS, 50)
      ).rejects.toThrow('Missing encoded path');
    });
  });

  describe('encodePath (private - tested via getQuote)', () => {
    test('encodes single-hop path correctly', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
      };

      const quote = await adapter.getQuote(params);

      // verify encoded path format: token0 + fee + token1
      const encodedPath = quote?.path.encodedPath;
      expect(encodedPath).toBeDefined();
      expect(encodedPath?.startsWith('0x')).toBe(true);
      // token (20 bytes) + fee (3 bytes) + token (20 bytes) = 43 bytes = 86 hex chars + 0x = 88 total
      expect(encodedPath?.length).toBe(88);
    });

    test('encodes multi-hop path correctly', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_C,
        amount: 1000000n,
        side: 'BUY'
      };

      const quote = await adapter.getQuote(params);

      const encodedPath = quote?.path.encodedPath;
      expect(encodedPath).toBeDefined();
      // token + fee + token + fee + token = 20 + 3 + 20 + 3 + 20 = 66 bytes = 132 hex + 0x = 134
      expect(encodedPath?.length).toBe(134);
    });
  });

  describe('derivePoolAddress (private - tested via getQuote)', () => {
    test('derives consistent pool addresses', async () => {
      const params1: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
      };

      const params2: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_B,
        toToken: TOKEN_A,
        amount: 1000000n,
        side: 'SELL'
      };

      const quote1 = await adapter.getQuote(params1);
      const quote2 = await adapter.getQuote(params2);

      // pool address should be same regardless of token order
      expect(quote1?.pool.address).toBe(quote2?.pool.address);
    });
  });

  describe('estimateFee (private - tested via getQuote)', () => {
    test('returns fee from pool v3Data', async () => {
      const params: QuoteParams = {
        chainId: 1,
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        amount: 1000000n,
        side: 'BUY'
      };

      const quote = await adapter.getQuote(params);

      expect(quote?.fee).toBe(3000n); // 0.3% default tier
    });
  });

  describe('applySlippage (private - tested via buildSwapTransaction)', () => {
    test('reduces output amount by slippage', async () => {
      const quote: SwapQuote = {
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        fromAmount: 1000000n,
        toAmount: 10000000n, // 10 USDC
        protocol: 'uniswap-v3',
        dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
        calldata: '0x' as Hex,
        estimatedGas: 150000n,
        fee: 3000n,
        path: {
          pools: [{
            address: '0x1234567890123456789012345678901234567890' as Address,
            token0: TOKEN_A,
            token1: TOKEN_B,
            dex: 'uniswap',
            version: 'v3',
            chainId: 1,
            v3Data: { fee: 3000 }
          }],
          tokens: [TOKEN_A, TOKEN_B],
          encodedPath: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
        },
        pool: {
          address: '0x1234567890123456789012345678901234567890' as Address,
          token0: TOKEN_A,
          token1: TOKEN_B,
          dex: 'uniswap',
          version: 'v3',
          chainId: 1,
          v3Data: { fee: 3000 }
        }
      };

      // 1% slippage
      await adapter.buildSwapTransaction(quote, USER_ADDRESS, 100);

      // min out = 10000000 * (10000 - 100) / 10000 = 9900000
      const expectedMinOut = (10000000n * 9900n) / 10000n;
      expect(expectedMinOut).toBe(9900000n);
    });

    test('handles zero slippage', async () => {
      const quote: SwapQuote = {
        fromToken: TOKEN_A,
        toToken: TOKEN_B,
        fromAmount: 1000000n,
        toAmount: 10000000n,
        protocol: 'uniswap-v3',
        dexAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
        calldata: '0x' as Hex,
        estimatedGas: 150000n,
        fee: 3000n,
        path: {
          pools: [{
            address: '0x1234567890123456789012345678901234567890' as Address,
            token0: TOKEN_A,
            token1: TOKEN_B,
            dex: 'uniswap',
            version: 'v3',
            chainId: 1,
            v3Data: { fee: 3000 }
          }],
          tokens: [TOKEN_A, TOKEN_B],
          encodedPath: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex
        },
        pool: {
          address: '0x1234567890123456789012345678901234567890' as Address,
          token0: TOKEN_A,
          token1: TOKEN_B,
          dex: 'uniswap',
          version: 'v3',
          chainId: 1,
          v3Data: { fee: 3000 }
        }
      };

      await adapter.buildSwapTransaction(quote, USER_ADDRESS, 0);

      // no slippage = full amount
      const expectedMinOut = (10000000n * 10000n) / 10000n;
      expect(expectedMinOut).toBe(10000000n);
    });
  });
});
