import { type Address, erc20Abi } from 'viem';
import { getViemClient } from '../blockchain/viem-client.js';
import { getRpcUrlForChain } from '../../shared/utils/chain-rpc.js';

export interface TokenInfo {
  decimals: number;
  symbol: string;
}

// token metadata never changes so cache indefinitely
const tokenInfoCache = new Map<string, TokenInfo>();

function cacheKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

// fetch decimals and symbol from an ERC20 contract via multicall
export async function getTokenInfo(
  chainId: number,
  tokenAddress: string
): Promise<TokenInfo> {
  // native ETH
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    return { decimals: 18, symbol: 'ETH' };
  }

  const key = cacheKey(chainId, tokenAddress);
  const cached = tokenInfoCache.get(key);
  if (cached) return cached;

  const rpcUrl = getRpcUrlForChain(chainId);
  const client = getViemClient(chainId, rpcUrl);
  const address = tokenAddress as Address;

  const results = await client.multicall({
    contracts: [
      {
        address,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address,
        abi: erc20Abi,
        functionName: 'symbol',
      },
    ],
  });

  const decimals = results[0].status === 'success' ? Number(results[0].result) : 18;
  const symbol = results[1].status === 'success' ? String(results[1].result) : 'UNKNOWN';

  const info: TokenInfo = { decimals, symbol };
  tokenInfoCache.set(key, info);
  return info;
}
