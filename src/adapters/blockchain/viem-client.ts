import { createPublicClient, http, PublicClient } from 'viem';
import { mainnet, base, arbitrum, optimism, polygon } from 'viem/chains';
import type { Chain } from 'viem';

const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
};

const clients: Map<number, PublicClient> = new Map();

export interface ChainRuntimeConfig {
  chainId: number;
  rpcUrl: string;
  blockTimeSeconds: number;
  confirmationBlocks: number;
}

export function getViemClient(
  chainId: number,
  rpcUrl: string
): PublicClient {
  const cached = clients.get(chainId);
  if (cached) {
    return cached;
  }

  const viemChain = VIEM_CHAINS[chainId];
  if (!viemChain) {
    throw new Error(`Viem chain not configured for chainId ${chainId}`);
  }

  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl, {
      timeout: 30_000,
      retryCount: 3,
      retryDelay: 1000,
    }),
  });

  clients.set(chainId, client);
  return client;
}

export function clearClientCache(chainId?: number): void {
  if (chainId !== undefined) {
    clients.delete(chainId);
  } else {
    clients.clear();
  }
}
