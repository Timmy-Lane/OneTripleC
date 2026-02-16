import { Address } from 'viem';
import { findTokenByChainAndSymbol } from '../../persistence/repositories/token-repository.js';

// cache WETH addresses per chain -- they never change at runtime
const wethCache = new Map<number, Address>();

export async function getWethAddress(chainId: number): Promise<Address | null> {
   const cached = wethCache.get(chainId);
   if (cached) return cached;

   const token = await findTokenByChainAndSymbol(chainId, 'WETH');
   if (!token) return null;

   const address = token.address as Address;
   wethCache.set(chainId, address);
   return address;
}

export async function isWeth(address: Address, chainId: number): Promise<boolean> {
   const wethAddress = await getWethAddress(chainId);
   if (!wethAddress) return false;
   return address.toLowerCase() === wethAddress.toLowerCase();
}
