import { Address } from 'viem';
import { Token, TokenConfig } from './token.js';

export const WETH_ADDRESSES: Record<number, Address> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  10: '0x4200000000000000000000000000000000000006',
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
};

export class WETH extends Token {
  constructor(chainId: number) {
    const address = WETH_ADDRESSES[chainId];
    if (!address) {
      throw new Error(`WETH not configured for chain ${chainId}`);
    }

    super({
      address,
      decimals: 18,
      symbol: 'WETH',
      chainId,
    });
  }

  public static isWETH(address: Address, chainId: number): boolean {
    const wethAddress = WETH_ADDRESSES[chainId];
    if (!wethAddress) return false;
    return address.toLowerCase() === wethAddress.toLowerCase();
  }

  public static getAddress(chainId: number): Address | null {
    return WETH_ADDRESSES[chainId] || null;
  }
}
