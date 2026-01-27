import { Address } from 'viem';

export type DexType = 'v2' | 'v3' | 'v4';

interface RouterConfig {
  requiresDeadline: boolean;
  address: Address;
}

const ROUTERS: Record<string, Partial<Record<DexType, Partial<Record<number, Address>>>>> = {
  uniswap: {
    v2: {
      1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      42161: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
      137: '0xedf6066a2b290C185783862C7F4776A2C8077AD1',
      10: '0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2',
      8453: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    },
    v3: {
      1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      42161: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      137: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      10: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      8453: '0x2626664c2603336E57B271c5C0b26F421741e481',
    },
  },
  sushiswap: {
    v2: {
      1: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      42161: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      137: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      10: '0x2ABf469074dc0b54d793850807E6eb5Faf2625b1',
      8453: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
    },
    v3: {
      1: '0x2E6cd2d30aa43f40aa81619ff4b6E0a41479B13F',
      42161: '0x8A21F6768C1f8075791D08546Dadf6daA0bE820c',
      137: '0x0aF89E1620b96170e2a9D0b68fEebb767eD044c3',
      10: '0x8c32Fd078B89Eccb06B40289A539D84A4aA9FDA6',
      8453: '0xFB7eF66a7e61224DD6FcD0D7d9C3be5C8B049b9f',
    },
  },
};

const ROUTER_DEADLINE_CONFIG: Record<string, Partial<Record<DexType, boolean>>> = {
  uniswap: { v2: true, v3: false, v4: false },
  sushiswap: { v2: true, v3: true },
};

export function getRouterAddress(
  dex: string,
  type: DexType,
  chainId: number
): Address | null {
  const dexRouters = ROUTERS[dex];
  if (!dexRouters) return null;

  const typeRouters = dexRouters[type];
  if (!typeRouters) return null;

  const address = typeRouters[chainId];
  return address || null;
}

export function requiresDeadline(dex: string, type: DexType): boolean {
  return ROUTER_DEADLINE_CONFIG[dex]?.[type] ?? true;
}

export function isDexSupported(dex: string, type: DexType, chainId: number): boolean {
  const address = getRouterAddress(dex, type, chainId);
  return address !== null;
}
