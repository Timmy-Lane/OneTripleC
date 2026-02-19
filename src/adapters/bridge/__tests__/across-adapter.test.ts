import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { type Address, type Hex, decodeFunctionData, parseAbiItem, getAddress } from 'viem';
import { AcrossAdapter, getSpokePoolAddress } from '../across-adapter.js';
import type { BridgeQuote, BridgeQuoteParams } from '../types.js';

// mock fetch globally
const mockFetch = mock(() => Promise.resolve(new Response()));
global.fetch = mockFetch as any;

const DEPOSIT_V3_ABI = parseAbiItem(
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable'
);

const USDC_ADDRESS = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const USDC_POLYGON = getAddress('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
const SENDER_ADDRESS = getAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// helper to build a complete V3 API response
function makeFeeResponse(overrides: Record<string, any> = {}) {
  return {
    relayFeePct: '10000000000000000',
    lpFeePct: '5000000000000000',
    timestamp: '1234567890',
    isAmountTooLow: false,
    spokePoolAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
    exclusiveRelayer: ZERO_ADDRESS,
    exclusivityDeadline: 0,
    fillDeadline: '1234570000',
    outputAmount: '985000',
    inputToken: { address: USDC_ADDRESS, symbol: 'USDC', decimals: 6, chainId: 1 },
    outputToken: { address: USDC_POLYGON, symbol: 'USDC', decimals: 6, chainId: 137 },
    ...overrides,
  };
}

function makeLimitsResponse(overrides: Record<string, any> = {}) {
  return {
    minDeposit: '100000',
    maxDeposit: '10000000000',
    maxDepositInstant: '10000000000',
    ...overrides,
  };
}

// helper to build a valid BridgeQuote for buildBridgeTransaction tests
function makeQuote(overrides: Partial<BridgeQuote> = {}): BridgeQuote {
  return {
    provider: 'across',
    sourceChainId: 1,
    destinationChainId: 137,
    token: USDC_ADDRESS,
    amount: 1000000n,
    estimatedOutput: 985000n,
    relayFeePct: '10000000000000000',
    lpFeePct: '5000000000000000',
    quoteTimestamp: 1234567890,
    spokePoolAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5' as Address,
    estimatedGas: 200_000n,
    inputToken: USDC_ADDRESS,
    outputToken: USDC_POLYGON,
    outputAmount: 985000n,
    fillDeadline: 1234570000,
    exclusiveRelayer: ZERO_ADDRESS,
    exclusivityDeadline: 0,
    ...overrides,
  };
}

describe('AcrossAdapter', () => {
  let adapter: AcrossAdapter;
  let baseParams: BridgeQuoteParams;

  beforeEach(() => {
    adapter = new AcrossAdapter();
    baseParams = {
      sourceChainId: 1,
      destinationChainId: 137,
      token: USDC_ADDRESS,
      amount: 1000000n, // 1 USDC (6 decimals)
      recipient: SENDER_ADDRESS,
    };
    mockFetch.mockClear();
  });

  describe('getQuote', () => {
    test('returns valid quote with correct fee calculation', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFeeResponse()), { status: 200 })
      );
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeLimitsResponse()), { status: 200 })
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).not.toBeNull();
      expect(quote?.provider).toBe('across');
      expect(quote?.sourceChainId).toBe(1);
      expect(quote?.destinationChainId).toBe(137);
      expect(quote?.token).toBe(USDC_ADDRESS);
      expect(quote?.amount).toBe(1000000n);
      expect(quote?.estimatedOutput).toBe(985000n);
      expect(quote?.relayFeePct).toBe('10000000000000000');
      expect(quote?.lpFeePct).toBe('5000000000000000');
      expect(quote?.quoteTimestamp).toBe(1234567890);
      expect(quote?.spokePoolAddress).toBe('0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');
      expect(quote?.estimatedGas).toBe(200_000n);
      // V3 fields
      expect(quote?.inputToken).toBe(USDC_ADDRESS);
      expect(quote?.outputToken).toBe(USDC_POLYGON);
      expect(quote?.outputAmount).toBe(985000n);
      expect(quote?.fillDeadline).toBe(1234570000);
    });

    test('returns null when fees API returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const quote = await adapter.getQuote(baseParams);

      expect(quote).toBeNull();
    });

    test('returns null when amount is too low (isAmountTooLow: true)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeFeeResponse({ isAmountTooLow: true })),
          { status: 200 }
        )
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).toBeNull();
    });

    test('returns null when amount is below minDeposit', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFeeResponse()), { status: 200 })
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeLimitsResponse({ minDeposit: '2000000' })),
          { status: 200 }
        )
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).toBeNull();
    });

    test('returns null when amount is above maxDepositInstant', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFeeResponse()), { status: 200 })
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeLimitsResponse({ maxDepositInstant: '500000' })),
          { status: 200 }
        )
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).toBeNull();
    });

    test('falls back to hardcoded spoke pool when API does not return one', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeFeeResponse({ spokePoolAddress: undefined })),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeLimitsResponse()), { status: 200 })
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).not.toBeNull();
      expect(quote?.spokePoolAddress).toBe('0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');
    });

    test('uses spoke pool address from API response when available', async () => {
      const customSpokePool = '0x1234567890123456789012345678901234567890' as Address;

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(makeFeeResponse({ spokePoolAddress: customSpokePool })),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeLimitsResponse()), { status: 200 })
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).not.toBeNull();
      expect(quote?.spokePoolAddress).toBe(customSpokePool);
    });

    test('returns null when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const quote = await adapter.getQuote(baseParams);

      expect(quote).toBeNull();
    });

    test('passes when amount is within limits', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFeeResponse()), { status: 200 })
      );
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeLimitsResponse()), { status: 200 })
      );

      const quote = await adapter.getQuote(baseParams);

      expect(quote).not.toBeNull();
    });

    test('returns true (allows) when limits API throws exception', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFeeResponse()), { status: 200 })
      );
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const quote = await adapter.getQuote(baseParams);

      expect(quote).not.toBeNull();
    });
  });

  describe('buildBridgeTransaction', () => {
    test('builds correct V3 calldata for ERC20 token bridge (value = 0n)', async () => {
      const quote = makeQuote();

      const tx = await adapter.buildBridgeTransaction(quote, SENDER_ADDRESS);

      expect(tx.to).toBe(quote.spokePoolAddress);
      expect(tx.value).toBe(0n);
      expect(tx.data).toBeTypeOf('string');
      expect(tx.data.startsWith('0x')).toBe(true);

      // decode and verify V3 arguments
      const decoded = decodeFunctionData({
        abi: [DEPOSIT_V3_ABI],
        data: tx.data,
      });

      expect(decoded.functionName).toBe('depositV3');
      expect(decoded.args).toEqual([
        SENDER_ADDRESS, // depositor
        SENDER_ADDRESS, // recipient
        USDC_ADDRESS, // inputToken
        USDC_POLYGON, // outputToken
        1000000n, // inputAmount
        985000n, // outputAmount
        137n, // destinationChainId
        ZERO_ADDRESS, // exclusiveRelayer
        1234567890, // quoteTimestamp
        1234570000, // fillDeadline
        0, // exclusivityDeadline
        '0x', // message (empty)
      ]);
    });

    test('sets value = amount for native ETH bridge (zero address token)', async () => {
      const nativeQuote = makeQuote({
        token: ZERO_ADDRESS,
        amount: 1000000000000000000n, // 1 ETH
        estimatedOutput: 999000000000000000n,
        outputAmount: 999000000000000000n,
        inputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
        outputToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
      });

      const tx = await adapter.buildBridgeTransaction(nativeQuote, SENDER_ADDRESS);

      expect(tx.to).toBe(nativeQuote.spokePoolAddress);
      expect(tx.value).toBe(1000000000000000000n); // should equal amount
      expect(tx.data).toBeTypeOf('string');
    });

    test('uses correct spoke pool address as to', async () => {
      const customSpokePool = '0x1234567890123456789012345678901234567890' as Address;
      const quote = makeQuote({ spokePoolAddress: customSpokePool });

      const tx = await adapter.buildBridgeTransaction(quote, SENDER_ADDRESS);

      expect(tx.to).toBe(customSpokePool);
    });

    test('encodes all depositV3 arguments correctly', async () => {
      const quote = makeQuote({
        sourceChainId: 10,
        destinationChainId: 8453,
        amount: 5000000n,
        estimatedOutput: 4950000n,
        outputAmount: 4950000n,
        relayFeePct: '20000000000000000',
        lpFeePct: '8000000000000000',
        quoteTimestamp: 1700000000,
        fillDeadline: 1700003600,
        spokePoolAddress: '0x6f26Bf09B1C792e3228e5467807a900A503c0281' as Address,
      });

      const tx = await adapter.buildBridgeTransaction(quote, SENDER_ADDRESS);

      const decoded = decodeFunctionData({
        abi: [DEPOSIT_V3_ABI],
        data: tx.data,
      });

      expect(decoded.args?.[0]).toBe(SENDER_ADDRESS); // depositor
      expect(decoded.args?.[1]).toBe(SENDER_ADDRESS); // recipient
      expect(decoded.args?.[2]).toBe(USDC_ADDRESS); // inputToken
      expect(decoded.args?.[3]).toBe(USDC_POLYGON); // outputToken
      expect(decoded.args?.[4]).toBe(5000000n); // inputAmount
      expect(decoded.args?.[5]).toBe(4950000n); // outputAmount
      expect(decoded.args?.[6]).toBe(8453n); // destinationChainId
      expect(decoded.args?.[7]).toBe(ZERO_ADDRESS); // exclusiveRelayer
      expect(decoded.args?.[8]).toBe(1700000000); // quoteTimestamp
      expect(decoded.args?.[9]).toBe(1700003600); // fillDeadline
      expect(decoded.args?.[10]).toBe(0); // exclusivityDeadline
      expect(decoded.args?.[11]).toBe('0x'); // message
    });
  });

  describe('getSpokePoolAddress', () => {
    test('returns correct address for Ethereum (chainId 1)', () => {
      expect(getSpokePoolAddress(1)).toBe('0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');
    });

    test('returns correct address for Polygon (chainId 137)', () => {
      expect(getSpokePoolAddress(137)).toBe('0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096');
    });

    test('returns correct address for Arbitrum (chainId 42161)', () => {
      expect(getSpokePoolAddress(42161)).toBe('0xe35e9842fceaca96570b734083f4a58e8f7c5f2a');
    });

    test('returns correct address for Optimism (chainId 10)', () => {
      expect(getSpokePoolAddress(10)).toBe('0x6f26Bf09B1C792e3228e5467807a900A503c0281');
    });

    test('returns correct address for Base (chainId 8453)', () => {
      expect(getSpokePoolAddress(8453)).toBe('0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64');
    });

    test('returns null for unknown chain ID', () => {
      expect(getSpokePoolAddress(99999)).toBeNull();
      expect(getSpokePoolAddress(56)).toBeNull(); // BSC
      expect(getSpokePoolAddress(43114)).toBeNull(); // Avalanche
    });
  });
});
