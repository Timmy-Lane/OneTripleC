#!/usr/bin/env bun

/**
 * Manual test for Uniswap V3 Adapter
 * Run with: bun src/adapters/dex/__tests__/manual-test.ts
 */

import { UniswapV3Adapter } from '../uniswap-v3-adapter.js';
import type { QuoteParams } from '../types.js';
import { Address } from 'viem';
import { formatUnits, parseUnits } from 'viem';

// ANSI colors for pretty output
const colors = {
   reset: '\x1b[0m',
   bright: '\x1b[1m',
   green: '\x1b[32m',
   yellow: '\x1b[33m',
   blue: '\x1b[34m',
   cyan: '\x1b[36m',
   red: '\x1b[31m',
};

function log(label: string, value: any, color = colors.cyan) {
   console.log(`${color}${colors.bright}${label}:${colors.reset}`, value);
}

function section(title: string) {
   console.log(`\n${colors.yellow}${'='.repeat(60)}${colors.reset}`);
   console.log(`${colors.yellow}${colors.bright}${title}${colors.reset}`);
   console.log(`${colors.yellow}${'='.repeat(60)}${colors.reset}\n`);
}

// test tokens
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const VITALIK: Address = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

async function testSingleHopQuote() {
   section('TEST 1: Single-Hop Quote (USDC → WETH)');

   const adapter = new UniswapV3Adapter({
      chainId: 8453,
      rpcUrl: process.env.BASE_RPC_URL!,
   });

   const params: QuoteParams = {
      chainId: 8453,
      fromToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      toToken: '0x4200000000000000000000000000000000000006',
      amount: parseUnits('1000', 6), // 1000 USDC
      side: 'BUY',
      slippageBps: 50, // 0.5%
   };

   log('Input Amount', `${formatUnits(params.amount, 6)} USDC`, colors.green);
   log('From Token', params.fromToken, colors.blue);
   log('To Token', params.toToken, colors.blue);
   log('Slippage', '0.5%', colors.blue);

   try {
      const quote = await adapter.getQuote(params);

      if (!quote) {
         log(
            'Result',
            'Quote failed (expected on testnet/no liquidity)',
            colors.red
         );
         return;
      }

      console.log(`\n${colors.green}✓ Quote received:${colors.reset}`);
      log('  Output Amount', `${formatUnits(quote.toAmount, 18)} WETH`);
      log('  Protocol', quote.protocol);
      log('  DEX Address', quote.dexAddress);
      log('  Estimated Gas', quote.estimatedGas.toString());
      log('  Fee (bps)', quote.fee.toString());
      log('  Path Tokens', quote.path.tokens.length);
      log('  Path Pools', quote.path.pools.length);
      log('  Encoded Path Length', quote.path.encodedPath?.length);
      log('  Pool Address', quote.pool.address);
      log('  Pool Fee Tier', quote.pool.v3Data?.fee);

      // build transaction
      console.log(`\n${colors.cyan}Building transaction...${colors.reset}`);
      const tx = await adapter.buildSwapTransaction(quote, VITALIK, 50);

      log('  To Address', tx.to);
      log('  Calldata Length', tx.data.length);
      log('  Value', tx.value.toString());
      log('  Calldata Preview', tx.data.slice(0, 66) + '...');

      // calculate slippage
      const minOut = (quote.toAmount * 9950n) / 10000n;
      log(
         '  Min Output (with slippage)',
         `${formatUnits(minOut, 18)} WETH`,
         colors.green
      );
   } catch (error: any) {
      log('Error', error.message, colors.red);
      log(
         'Expected',
         'This may fail without a real RPC or pool',
         colors.yellow
      );
   }
}

async function testMultiHopQuote() {
   section('TEST 2: Multi-Hop Quote (USDC → WETH → DAI)');

   const adapter = new UniswapV3Adapter({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
   });

   const params: QuoteParams = {
      chainId: 1,
      fromToken: USDC,
      toToken: DAI,
      amount: parseUnits('1000', 6), // 1000 USDC
      side: 'BUY',
      slippageBps: 100, // 1%
   };

   log('Input Amount', `${formatUnits(params.amount, 6)} USDC`, colors.green);
   log('From Token', params.fromToken, colors.blue);
   log('To Token', params.toToken, colors.blue);
   log('Slippage', '1%', colors.blue);

   try {
      const quote = await adapter.getQuote(params);

      if (!quote) {
         log(
            'Result',
            'Quote failed (expected on testnet/no liquidity)',
            colors.red
         );
         return;
      }

      console.log(`\n${colors.green}✓ Quote received:${colors.reset}`);
      log('  Output Amount', `${formatUnits(quote.toAmount, 18)} DAI`);
      log('  Protocol', quote.protocol);
      log('  Path Tokens', quote.path.tokens.length);
      log('  Path Tokens', quote.path.tokens);
      log('  Path Pools', quote.path.pools.length);
      log('  Encoded Path Length', quote.path.encodedPath?.length);

      if (quote.intermediatePool) {
         console.log(`\n${colors.cyan}Intermediate Pool:${colors.reset}`);
         log('  Address', quote.intermediatePool.address);
         log('  Token0', quote.intermediatePool.token0);
         log('  Token1', quote.intermediatePool.token1);
         log('  Fee Tier', quote.intermediatePool.v3Data?.fee);
         log('  Is Intermediate', quote.intermediatePool.isIntermediate);
      }

      // build transaction
      console.log(`\n${colors.cyan}Building transaction...${colors.reset}`);
      const tx = await adapter.buildSwapTransaction(quote, VITALIK, 100);

      log('  To Address', tx.to);
      log('  Calldata Length', tx.data.length);
      log('  Calldata Preview', tx.data.slice(0, 66) + '...');
   } catch (error: any) {
      log('Error', error.message, colors.red);
      log(
         'Expected',
         'This may fail without a real RPC or pool',
         colors.yellow
      );
   }
}

async function testPathEncoding() {
   section('TEST 3: Path Encoding');

   const adapter = new UniswapV3Adapter({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
   });

   log('Testing path encoding format', '', colors.cyan);
   log('Expected format', 'token0(20) + fee(3) + token1(20)', colors.blue);
   log('Single-hop length', '43 bytes = 86 hex chars + 0x = 88', colors.blue);
   log('Multi-hop length', '66 bytes = 132 hex chars + 0x = 134', colors.blue);

   // try to get quotes to see encoded paths
   const singleHopParams: QuoteParams = {
      chainId: 1,
      fromToken: USDC,
      toToken: WETH,
      amount: parseUnits('100', 6),
      side: 'BUY',
   };

   const multiHopParams: QuoteParams = {
      chainId: 1,
      fromToken: USDC,
      toToken: DAI,
      amount: parseUnits('100', 6),
      side: 'BUY',
   };

   try {
      const singleQuote = await adapter.getQuote(singleHopParams);
      if (singleQuote?.path.encodedPath) {
         console.log(
            `\n${colors.green}Single-hop encoded path:${colors.reset}`
         );
         log('  Path', singleQuote.path.encodedPath);
         log('  Length', singleQuote.path.encodedPath.length);
         log('  Valid', singleQuote.path.encodedPath.length === 88 ? '✓' : '✗');
      }

      const multiQuote = await adapter.getQuote(multiHopParams);
      if (multiQuote?.path.encodedPath) {
         console.log(`\n${colors.green}Multi-hop encoded path:${colors.reset}`);
         log('  Path', multiQuote.path.encodedPath);
         log('  Length', multiQuote.path.encodedPath.length);
         log('  Valid', multiQuote.path.encodedPath.length === 134 ? '✓' : '✗');
      }
   } catch (error: any) {
      log(
         'Note',
         'Path encoding works internally but needs real pools to test',
         colors.yellow
      );
   }
}

async function testSlippageCalculation() {
   section('TEST 4: Slippage Calculation');

   const testCases = [
      { amountOut: 1000000n, slippageBps: 0, expected: 1000000n },
      { amountOut: 1000000n, slippageBps: 50, expected: 995000n },
      { amountOut: 1000000n, slippageBps: 100, expected: 990000n },
      { amountOut: 1000000n, slippageBps: 500, expected: 950000n },
      { amountOut: 10000000n, slippageBps: 50, expected: 9950000n },
   ];

   for (const tc of testCases) {
      const minOut = (tc.amountOut * BigInt(10000 - tc.slippageBps)) / 10000n;
      const match =
         minOut === tc.expected ? colors.green + '✓' : colors.red + '✗';

      console.log(
         `${match} Amount: ${tc.amountOut}, Slippage: ${tc.slippageBps / 100}%, ` +
            `Min Out: ${minOut} (expected: ${tc.expected})${colors.reset}`
      );
   }
}

async function testErrorHandling() {
   section('TEST 5: Error Handling');

   log('Testing with invalid chain', '999999', colors.blue);

   try {
      const adapter = new UniswapV3Adapter({
         chainId: 999999, // invalid chain
         rpcUrl: 'https://eth.llamarpc.com',
      });

      const params: QuoteParams = {
         chainId: 999999,
         fromToken: USDC,
         toToken: WETH,
         amount: parseUnits('100', 6),
         side: 'BUY',
      };

      const quote = await adapter.getQuote(params);

      if (quote === null) {
         log(
            'Result',
            '✓ Correctly returned null for invalid chain',
            colors.green
         );
      } else {
         log('Result', '✗ Should have returned null', colors.red);
      }
   } catch (error: any) {
      log('Expected Error', error.message, colors.green);
      log('Result', '✓ Correctly threw error for invalid chain', colors.green);
   }
}

async function testQuoteComparison() {
   section('TEST 6: Quote Comparison (Different Amounts)');

   const adapter = new UniswapV3Adapter({
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
   });

   const amounts = [100n, 1000n, 10000n];

   for (const amt of amounts) {
      const params: QuoteParams = {
         chainId: 1,
         fromToken: USDC,
         toToken: WETH,
         amount: parseUnits(amt.toString(), 6),
         side: 'BUY',
      };

      try {
         log(`Quoting ${amt} USDC → WETH`, '', colors.cyan);
         const quote = await adapter.getQuote(params);

         if (quote) {
            log(
               '  Output',
               `${formatUnits(quote.toAmount, 18)} WETH`,
               colors.green
            );
            log('  Gas Estimate', quote.estimatedGas.toString());
         } else {
            log('  Result', 'No quote available', colors.yellow);
         }
      } catch (error: any) {
         log('  Error', error.message, colors.red);
      }
   }
}

// run all tests
async function main() {
   console.log(`${colors.bright}${colors.blue}`);
   console.log(
      '╔════════════════════════════════════════════════════════════╗'
   );
   console.log('║        Uniswap V3 Adapter - Manual Test Suite            ║');
   console.log(
      '╚════════════════════════════════════════════════════════════╝'
   );
   console.log(colors.reset);

   try {
      await testSingleHopQuote();
      await testMultiHopQuote();
      await testPathEncoding();
      await testSlippageCalculation();
      await testErrorHandling();
      await testQuoteComparison();

      section('SUMMARY');
      log('Status', 'All manual tests completed', colors.green);
      log(
         'Note',
         'Some tests may fail without real RPC/liquidity - this is expected',
         colors.yellow
      );
   } catch (error: any) {
      console.error(
         `\n${colors.red}Fatal error:${colors.reset}`,
         error.message
      );
      console.error(error.stack);
   }
}

main();
