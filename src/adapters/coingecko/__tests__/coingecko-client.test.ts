import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// save original fetch so we can restore it
const originalFetch = globalThis.fetch;

// mock fetch globally
let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
   mockFetchFn = mock(() =>
      Promise.resolve({
         ok: true,
         json: () => Promise.resolve({}),
      })
   );
   globalThis.fetch = mockFetchFn as any;
});

afterEach(() => {
   globalThis.fetch = originalFetch;
});

// module-level priceCache in coingecko-client persists across tests.
// each test must use a unique token address / chain to avoid cache collisions.

import {
   getTokenPriceUsd,
   getNativePriceUsd,
   getMultipleTokenPricesUsd,
} from '../coingecko-client.js';

describe('coingecko-client', () => {
   describe('getTokenPriceUsd', () => {
      test('returns price for valid token on Ethereum', async () => {
         const addr = '0xaaaa000000000000000000000000000000000001';
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [addr]: { usd: 0.999 },
            }),
         });

         const price = await getTokenPriceUsd(1, addr);

         expect(price).toBe(0.999);
         expect(mockFetchFn).toHaveBeenCalledTimes(1);

         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain('ethereum');
         expect(url).toContain(addr);
      });

      test('returns price for token on Base', async () => {
         const addr = '0xaaaa000000000000000000000000000000000002';
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [addr]: { usd: 1.001 },
            }),
         });

         const price = await getTokenPriceUsd(8453, addr);

         expect(price).toBe(1.001);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain('base');
      });

      test('returns null for unsupported chain', async () => {
         const price = await getTokenPriceUsd(999, '0xaaaa000000000000000000000000000000000003');

         expect(price).toBeNull();
         expect(mockFetchFn).not.toHaveBeenCalled();
      });

      test('returns null when API returns no price data', async () => {
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({}),
         });

         const price = await getTokenPriceUsd(1, '0xaaaa000000000000000000000000000000000004');
         expect(price).toBeNull();
      });

      test('returns null on API error', async () => {
         mockFetchFn.mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
         });

         const price = await getTokenPriceUsd(1, '0xaaaa000000000000000000000000000000000005');
         expect(price).toBeNull();
      });

      test('returns null on network error', async () => {
         mockFetchFn.mockRejectedValueOnce(new Error('network timeout'));

         const price = await getTokenPriceUsd(1, '0xaaaa000000000000000000000000000000000006');
         expect(price).toBeNull();
      });

      test('lowercases token address for cache key and API', async () => {
         // use a unique address not seen before
         const mixedCase = '0xBBBB000000000000000000000000000000000007';
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [mixedCase.toLowerCase()]: { usd: 1.23 },
            }),
         });

         const price = await getTokenPriceUsd(1, mixedCase);

         expect(price).toBe(1.23);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain(mixedCase.toLowerCase());
      });

      test('uses cached value on second call', async () => {
         const addr = '0xaaaa000000000000000000000000000000000008';
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [addr]: { usd: 42.5 },
            }),
         });

         const price1 = await getTokenPriceUsd(1, addr);
         const price2 = await getTokenPriceUsd(1, addr);

         expect(price1).toBe(42.5);
         expect(price2).toBe(42.5);
         expect(mockFetchFn).toHaveBeenCalledTimes(1);
      });

      test('includes API key header when env var is set', async () => {
         const prevKey = process.env.COINGECKO_API_KEY;
         process.env.COINGECKO_API_KEY = 'test-key-123';

         const addr = '0xaaaa000000000000000000000000000000000009';
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [addr]: { usd: 2.0 },
            }),
         });

         await getTokenPriceUsd(1, addr);

         const fetchCall = mockFetchFn.mock.calls[0];
         const options = fetchCall[1] as any;
         expect(options.headers['x-cg-demo-api-key']).toBe('test-key-123');

         if (prevKey) {
            process.env.COINGECKO_API_KEY = prevKey;
         } else {
            delete process.env.COINGECKO_API_KEY;
         }
      });
   });

   describe('getNativePriceUsd', () => {
      // native:ethereum cache key is shared by chains 1, 8453, 42161, 10.
      // native:matic-network is unique to chain 137.
      // test Polygon first (unique key), then verify Ethereum cache behavior.

      test('returns MATIC price for Polygon', async () => {
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               'matic-network': { usd: 0.85 },
            }),
         });

         const price = await getNativePriceUsd(137);

         expect(price).toBe(0.85);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain('ids=matic-network');
      });

      test('returns ETH price for Ethereum mainnet', async () => {
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               ethereum: { usd: 3500.0 },
            }),
         });

         const price = await getNativePriceUsd(1);

         expect(price).toBe(3500.0);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain('ids=ethereum');
      });

      test('returns null for unsupported chain', async () => {
         const price = await getNativePriceUsd(999);

         expect(price).toBeNull();
         expect(mockFetchFn).not.toHaveBeenCalled();
      });

      test('caches native price -- second call skips fetch', async () => {
         // chain 1 was already fetched above, so this should be cached
         mockFetchFn.mockClear();

         const price = await getNativePriceUsd(1);

         expect(price).toBe(3500.0);
         expect(mockFetchFn).not.toHaveBeenCalled();
      });

      test('chains sharing same coin ID share cache (Base uses ethereum)', async () => {
         // chain 8453 maps to coin ID "ethereum", already cached at 3500.0
         mockFetchFn.mockClear();

         const price = await getNativePriceUsd(8453);

         expect(price).toBe(3500.0);
         // no fetch because native:ethereum is already cached
         expect(mockFetchFn).not.toHaveBeenCalled();
      });
   });

   describe('getMultipleTokenPricesUsd', () => {
      test('returns prices for multiple tokens', async () => {
         const tokenA = '0xbbbb000000000000000000000000000000000001';
         const tokenB = '0xbbbb000000000000000000000000000000000002';

         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [tokenA]: { usd: 1.0 },
               [tokenB]: { usd: 2500.0 },
            }),
         });

         const prices = await getMultipleTokenPricesUsd(1, [tokenA, tokenB]);

         expect(prices.get(tokenA)).toBe(1.0);
         expect(prices.get(tokenB)).toBe(2500.0);
         expect(prices.size).toBe(2);
      });

      test('returns empty map for unsupported chain', async () => {
         const prices = await getMultipleTokenPricesUsd(999, ['0xbbbb000000000000000000000000000000000003']);

         expect(prices.size).toBe(0);
         expect(mockFetchFn).not.toHaveBeenCalled();
      });

      test('uses cache for already-fetched tokens', async () => {
         const cachedToken = '0xbbbb000000000000000000000000000000000004';
         const freshToken = '0xbbbb000000000000000000000000000000000005';

         // prime cache for cachedToken
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [cachedToken]: { usd: 10.0 },
            }),
         });
         await getTokenPriceUsd(1, cachedToken);
         mockFetchFn.mockClear();

         // multi call should only fetch freshToken
         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [freshToken]: { usd: 20.0 },
            }),
         });

         const prices = await getMultipleTokenPricesUsd(1, [cachedToken, freshToken]);

         expect(prices.get(cachedToken)).toBe(10.0);
         expect(prices.get(freshToken)).toBe(20.0);
         expect(mockFetchFn).toHaveBeenCalledTimes(1);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain(freshToken);
         expect(url).not.toContain(cachedToken);
      });

      test('skips fetch when all tokens are cached', async () => {
         // cachedToken from previous test is still in cache
         const cachedToken = '0xbbbb000000000000000000000000000000000004';
         mockFetchFn.mockClear();

         const prices = await getMultipleTokenPricesUsd(1, [cachedToken]);

         expect(prices.get(cachedToken)).toBe(10.0);
         expect(mockFetchFn).not.toHaveBeenCalled();
      });

      test('returns empty result on API error', async () => {
         const tokenX = '0xbbbb000000000000000000000000000000000006';

         mockFetchFn.mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
         });

         const prices = await getMultipleTokenPricesUsd(1, [tokenX]);

         expect(prices.size).toBe(0);
      });

      test('batches uncached addresses into single API call', async () => {
         const t1 = '0xcccc000000000000000000000000000000000001';
         const t2 = '0xcccc000000000000000000000000000000000002';
         const t3 = '0xcccc000000000000000000000000000000000003';

         mockFetchFn.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
               [t1]: { usd: 1.0 },
               [t2]: { usd: 2.0 },
               [t3]: { usd: 3.0 },
            }),
         });

         const prices = await getMultipleTokenPricesUsd(1, [t1, t2, t3]);

         expect(prices.size).toBe(3);
         expect(mockFetchFn).toHaveBeenCalledTimes(1);
         const url = mockFetchFn.mock.calls[0][0] as string;
         expect(url).toContain(`${t1},${t2},${t3}`);
      });
   });
});
