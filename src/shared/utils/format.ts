import { formatUnits, formatEther } from 'viem';
import type { QuoteRoute } from '../types/quote.js';

export function formatTokenAmount(weiAmount: string, decimals: number): string {
   const formatted = formatUnits(BigInt(weiAmount), decimals);

   let displayDecimals: number;
   if (decimals <= 6) {
      displayDecimals = 3;
   } else if (decimals <= 8) {
      displayDecimals = 4;
   } else {
      displayDecimals = 4;
   }

   // truncate (not round) to desired precision
   const dotIndex = formatted.indexOf('.');
   if (dotIndex === -1) {
      return formatted + '.0';
   }

   const truncated = formatted.slice(0, dotIndex + 1 + displayDecimals);

   const trimmed = truncated.replace(/0+$/, '');
   if (trimmed.endsWith('.')) {
      return trimmed + '0';
   }
   return trimmed;
}

export function formatProviderName(route: QuoteRoute): string {
   if (route.provider === 'across') {
      return 'Across Bridge';
   }

   if (route.poolVersion) {
      const version = route.poolVersion.toUpperCase();
      if (route.poolFeeBps !== undefined) {
         const pct = (route.poolFeeBps / 100).toFixed(2);
         return `Uniswap ${version} (${pct}%)`;
      }
      return `Uniswap ${version}`;
   }

   return route.provider;
}

export function formatFeeDisplay(opts: {
   totalFeeUsd?: string;
   totalFeeWei?: string;
   gasPriceGwei?: string;
}): string {
   const { totalFeeUsd, totalFeeWei, gasPriceGwei } = opts;
   const gweiSuffix = gasPriceGwei ? ` (${gasPriceGwei} gwei)` : '';

   if (totalFeeUsd) {
      return `~$${totalFeeUsd}${gweiSuffix}`;
   }

   if (totalFeeWei) {
      const ethValue = Number(formatEther(BigInt(totalFeeWei)));
      const ethStr =
         ethValue < 0.0001
            ? ethValue.toExponential(2)
            : ethValue.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
      return `${ethStr} ETH${gweiSuffix}`;
   }

   return 'Unknown';
}
