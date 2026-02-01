import { config } from '../config/index.js';

export function getRpcUrlForChain(chainId: number): string {
   switch (chainId) {
      case 1:
         return config.ETHEREUM_RPC_URL;
      case 8453:
         return config.BASE_RPC_URL;
      case 42161:
         return config.ARBITRUM_RPC_URL;
      default:
         throw new Error(`Unsupported chain ID: ${chainId}`);
   }
}

export function getChainName(chainId: number): string {
   switch (chainId) {
      case 1:
         return 'Ethereum';
      case 8453:
         return 'Base';
      case 42161:
         return 'Arbitrum';
      default:
         return 'Unknown';
   }
}

export function isChainSupported(chainId: number): boolean {
   return chainId === 1 || chainId === 8453 || chainId === 42161;
} // remove
