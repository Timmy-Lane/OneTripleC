import { Address } from 'viem';

const QUOTERS: Record<string, Partial<Record<number, Address>>> = {
  uniswap: {
    1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    137: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  },
  sushiswap: {
    1: '0x64e8802FE490fa7cc61d3463958199161Bb608A7',
    42161: '0x0524E833cCD057e4d7A296e3aaAb9f7675964Ce1',
    137: '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
    10: '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
    8453: '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
  },
};

export function getQuoterAddress(dex: string, chainId: number): Address | null {
  const dexQuoters = QUOTERS[dex];
  if (!dexQuoters) return null;

  const address = dexQuoters[chainId];
  return address || null;
}

export function hasQuoter(dex: string, chainId: number): boolean {
  return getQuoterAddress(dex, chainId) !== null;
}
