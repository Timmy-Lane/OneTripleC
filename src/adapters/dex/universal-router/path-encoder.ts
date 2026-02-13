import { Address, Hex, concat, toHex } from 'viem';

/**
 * Encodes a Uniswap V3 path for multi-hop swaps
 * Format: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes) + ...
 *
 * @example
 * // Single hop: USDC -> 0.3% -> WETH
 * encodeV3Path([USDC, WETH], [3000])
 *
 * // Multi-hop: USDC -> 0.3% -> WETH -> 0.05% -> DAI
 * encodeV3Path([USDC, WETH, DAI], [3000, 500])
 */
export function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length !== fees.length + 1) {
    throw new Error('Invalid path: tokens.length must equal fees.length + 1');
  }

  const segments: Hex[] = [];

  for (let i = 0; i < fees.length; i++) {
    // Add token
    segments.push(tokens[i]);
    // Add fee (3 bytes)
    segments.push(toHex(fees[i], { size: 3 }));
  }

  // Add final token
  segments.push(tokens[tokens.length - 1]);

  return concat(segments);
}

/**
 * Decodes a V3 path back to tokens and fees
 * Useful for testing and debugging
 */
export function decodeV3Path(path: Hex): { tokens: Address[]; fees: number[] } {
  const tokens: Address[] = [];
  const fees: number[] = [];

  let offset = 0;
  const pathBytes = path.slice(2); // Remove '0x'

  while (offset < pathBytes.length) {
    // Read token (20 bytes = 40 hex chars)
    const token = ('0x' + pathBytes.slice(offset, offset + 40)) as Address;
    tokens.push(token);
    offset += 40;

    // If there's more data, read fee (3 bytes = 6 hex chars)
    if (offset < pathBytes.length) {
      const feeHex = pathBytes.slice(offset, offset + 6);
      const fee = parseInt(feeHex, 16);
      fees.push(fee);
      offset += 6;
    }
  }

  return { tokens, fees };
}
