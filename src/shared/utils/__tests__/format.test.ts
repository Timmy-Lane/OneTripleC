import { describe, test, expect } from 'bun:test';
import { parseUnits } from 'viem';
import {
   formatTokenAmount,
   formatProviderName,
   formatFeeDisplay,
} from '../format.js';
import type { QuoteRoute } from '../../types/quote.js';

describe('formatTokenAmount', () => {
   test('6-decimal token (USDC) truncates to 3 places', () => {
      // 4.999123 USDC = 4999123 wei
      expect(formatTokenAmount('4999123', 6)).toBe('4.999');
   });

   test('6-decimal token does not round up', () => {
      // 4.999999 USDC = 4999999 wei -- should NOT become 5.0
      expect(formatTokenAmount('4999999', 6)).toBe('4.999');
   });

   test('6-decimal token with trailing zeros', () => {
      // 5.000000 USDC = 5000000 wei
      expect(formatTokenAmount('5000000', 6)).toBe('5.0');
   });

   test('8-decimal token (WBTC) truncates to 4 places', () => {
      // 0.12345678 WBTC
      expect(formatTokenAmount('12345678', 8)).toBe('0.1234');
   });

   test('18-decimal token (ETH) truncates to 4 places', () => {
      // 0.001523456789 ETH
      const wei = parseUnits('0.001523456789', 18).toString();
      expect(formatTokenAmount(wei, 18)).toBe('0.0015');
   });

   test('18-decimal token with large value', () => {
      const wei = parseUnits('1234.56789', 18).toString();
      expect(formatTokenAmount(wei, 18)).toBe('1234.5678');
   });

   test('whole number has single trailing zero', () => {
      const wei = parseUnits('100', 18).toString();
      expect(formatTokenAmount(wei, 18)).toBe('100.0');
   });

   test('zero amount', () => {
      expect(formatTokenAmount('0', 18)).toBe('0.0');
   });
});

describe('formatProviderName', () => {
   const baseRoute: QuoteRoute = {
      steps: [],
      fees: { gasEstimate: '0', protocolFee: '0', bridgeFee: '0', dexFee: '0' },
      slippageBps: 50,
      provider: 'universal-router',
   };

   test('V3 with fee bps', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         poolVersion: 'v3',
         poolFeeBps: 30,
      };
      expect(formatProviderName(route)).toBe('Uniswap V3 (0.30%)');
   });

   test('V3 with 0.05% fee', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         poolVersion: 'v3',
         poolFeeBps: 5,
      };
      expect(formatProviderName(route)).toBe('Uniswap V3 (0.05%)');
   });

   test('V3 with 1% fee', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         poolVersion: 'v3',
         poolFeeBps: 100,
      };
      expect(formatProviderName(route)).toBe('Uniswap V3 (1.00%)');
   });

   test('V2 with fee', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         poolVersion: 'v2',
         poolFeeBps: 30,
      };
      expect(formatProviderName(route)).toBe('Uniswap V2 (0.30%)');
   });

   test('V3 without fee bps', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         poolVersion: 'v3',
      };
      expect(formatProviderName(route)).toBe('Uniswap V3');
   });

   test('Across bridge', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         provider: 'across',
      };
      expect(formatProviderName(route)).toBe('Across Bridge');
   });

   test('fallback to raw provider', () => {
      const route: QuoteRoute = {
         ...baseRoute,
         provider: 'some-dex',
      };
      expect(formatProviderName(route)).toBe('some-dex');
   });
});

describe('formatFeeDisplay', () => {
   test('USD + gas price', () => {
      expect(
         formatFeeDisplay({
            totalFeeUsd: '0.50',
            gasPriceGwei: '12.5',
         })
      ).toBe('~$0.50 (12.5 gwei)');
   });

   test('USD only', () => {
      expect(
         formatFeeDisplay({
            totalFeeUsd: '14.00',
         })
      ).toBe('~$14.00');
   });

   test('no USD, has wei + gas', () => {
      // 0.002 ETH = 2000000000000000 wei
      expect(
         formatFeeDisplay({
            totalFeeWei: '2000000000000000',
            gasPriceGwei: '20',
         })
      ).toBe('0.002 ETH (20 gwei)');
   });

   test('no USD, has wei only', () => {
      expect(
         formatFeeDisplay({
            totalFeeWei: '2000000000000000',
         })
      ).toBe('0.002 ETH');
   });

   test('no data returns Unknown', () => {
      expect(formatFeeDisplay({})).toBe('Unknown');
   });
});
