import type { Address } from 'viem';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

// platform IDs for CoinGecko's /simple/token_price endpoint
const PLATFORM_IDS: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  42161: 'arbitrum-one',
  10: 'optimism',
  137: 'polygon-pos',
};

// native currency CoinGecko IDs per chain
const NATIVE_CURRENCY_IDS: Record<number, string> = {
  1: 'ethereum',
  8453: 'ethereum',
  42161: 'ethereum',
  10: 'ethereum',
  137: 'matic-network',
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

const priceCache = new Map<string, CacheEntry<number>>();

function getCached(key: string): number | null {
  const entry = priceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    priceCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key: string, value: number): void {
  priceCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function getApiKey(): string | undefined {
  return process.env.COINGECKO_API_KEY;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }
  return headers;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: buildHeaders() });
  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// get USD price for a token by contract address
export async function getTokenPriceUsd(
  chainId: number,
  tokenAddress: string
): Promise<number | null> {
  const platform = PLATFORM_IDS[chainId];
  if (!platform) return null;

  const addr = tokenAddress.toLowerCase();
  const cacheKey = `token:${chainId}:${addr}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  try {
    const url = `${COINGECKO_BASE_URL}/simple/token_price/${platform}?contract_addresses=${addr}&vs_currencies=usd`;
    const data = await fetchJson(url);
    const price = data[addr]?.usd;
    if (typeof price === 'number') {
      setCache(cacheKey, price);
      return price;
    }
    return null;
  } catch (error) {
    console.error(`[CoinGecko] Failed to fetch token price for ${tokenAddress} on chain ${chainId}:`, error);
    return null;
  }
}

// get USD price for the native currency of a chain
export async function getNativePriceUsd(chainId: number): Promise<number | null> {
  const coinId = NATIVE_CURRENCY_IDS[chainId];
  if (!coinId) return null;

  const cacheKey = `native:${coinId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  try {
    const url = `${COINGECKO_BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const data = await fetchJson(url);
    const price = data[coinId]?.usd;
    if (typeof price === 'number') {
      setCache(cacheKey, price);
      return price;
    }
    return null;
  } catch (error) {
    console.error(`[CoinGecko] Failed to fetch native price for chain ${chainId}:`, error);
    return null;
  }
}

// get USD prices for multiple tokens on the same chain
export async function getMultipleTokenPricesUsd(
  chainId: number,
  addresses: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const platform = PLATFORM_IDS[chainId];
  if (!platform) return result;

  // check cache first, collect uncached
  const uncached: string[] = [];
  for (const addr of addresses) {
    const lower = addr.toLowerCase();
    const cacheKey = `token:${chainId}:${lower}`;
    const cached = getCached(cacheKey);
    if (cached !== null) {
      result.set(lower, cached);
    } else {
      uncached.push(lower);
    }
  }

  if (uncached.length === 0) return result;

  try {
    const contractList = uncached.join(',');
    const url = `${COINGECKO_BASE_URL}/simple/token_price/${platform}?contract_addresses=${contractList}&vs_currencies=usd`;
    const data = await fetchJson(url);

    for (const addr of uncached) {
      const price = data[addr]?.usd;
      if (typeof price === 'number') {
        setCache(`token:${chainId}:${addr}`, price);
        result.set(addr, price);
      }
    }
  } catch (error) {
    console.error(`[CoinGecko] Failed to fetch multiple token prices on chain ${chainId}:`, error);
  }

  return result;
}
