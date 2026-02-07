import { config } from '../config/index.js';
import {
   findChainById,
   findActiveChains,
   isChainSupported as dbIsChainSupported,
   type Chain,
} from '../../persistence/repositories/chain-repository.js';

// RPC URLs from .env (primary source for RPCs) u can change it
const ENV_RPC_URLS: Record<number, string> = {
   1: config.ETHEREUM_RPC_URL,
   8453: config.BASE_RPC_URL,
   42161: config.ARBITRUM_RPC_URL,
};

export function getRpcUrlForChain(chainId: number): string {
   const rpcUrl = ENV_RPC_URLS[chainId];
   if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ID: ${chainId}`);
   }
   return rpcUrl;
}

export async function getChainName(chainId: number): Promise<string> {
   const chain = await findChainById(chainId);
   return chain?.name || 'Unknown';
}

export async function getChain(chainId: number): Promise<Chain | null> {
   return findChainById(chainId);
}

export async function getActiveChains(): Promise<Chain[]> {
   return findActiveChains();
}

export async function getExplorerUrl(chainId: number): Promise<string | null> {
   const chain = await findChainById(chainId);
   return chain?.explorerUrl || null;
}

export async function getNativeToken(chainId: number): Promise<string | null> {
   const chain = await findChainById(chainId);
   return chain?.nativeToken || null;
}

export async function isChainSupported(chainId: number): Promise<boolean> {
   const isSupported = await dbIsChainSupported(chainId);
   if (!isSupported) return false;

   return chainId in ENV_RPC_URLS;
}

export function hasRpcConfigured(chainId: number): boolean {
   return chainId in ENV_RPC_URLS;
}

export function getConfiguredChainIds(): number[] {
   return Object.keys(ENV_RPC_URLS).map(Number);
}
