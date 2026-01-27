import { Address, isAddressEqual } from 'viem';
import { WETH } from '../../tokens/weth.js';

export function isPairedWithWeth(
  token0: Address,
  token1: Address,
  chainId: number
): boolean {
  const wethAddress = WETH.getAddress(chainId);
  if (!wethAddress) return false;

  return (
    isAddressEqual(token0, wethAddress) || isAddressEqual(token1, wethAddress)
  );
}

export function getOtherToken(
  token0: Address,
  token1: Address,
  targetToken: Address
): Address {
  return isAddressEqual(targetToken, token0) ? token1 : token0;
}

export function isNativeToken(address: Address): boolean {
  return isAddressEqual(address, '0x0000000000000000000000000000000000000000');
}
