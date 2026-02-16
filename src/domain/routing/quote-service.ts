import type { FastifyBaseLogger } from 'fastify';
import type { QuoteRoute, RouteStep } from '../../shared/types/quote.js';
import { RouteStepType } from '../../shared/types/quote.js';
import { UniversalRouterAdapter } from '../../adapters/dex/universal-router-adapter.js';
import {
   getUniversalRouterAddress,
   PERMIT2_ADDRESS,
} from '../../adapters/dex/universal-router/constants.js';
import type {
   DexAdapter,
   QuoteParams,
   SwapQuote as InternalSwapQuote,
} from '../../adapters/dex/types.js';
import { Address, formatEther, formatGwei } from 'viem';
import { getWethAddress } from '../../adapters/tokens/weth.js';
import { getViemClient } from '../../adapters/blockchain/viem-client.js';
import { getNativePriceUsd } from '../../adapters/coingecko/index.js';
import { AcrossAdapter } from '../../adapters/bridge/across-adapter.js';
import type { BridgeAdapter } from '../../adapters/bridge/types.js';
import { getRpcUrlForChain } from '../../shared/utils/chain-rpc.js';

interface Logger {
   info(obj: object, msg?: string): void;
   error(obj: object, msg?: string): void;
}

const consoleLogger: Logger = {
   info: (obj, msg) => console.log(msg || '', obj),
   error: (obj, msg) => console.error(msg || '', obj),
};

let logger: Logger = consoleLogger;

export function setQuoteServiceLogger(loggerInstance: FastifyBaseLogger): void {
   logger = loggerInstance as unknown as Logger;
}

export interface QuoteRequest {
   sourceChainId: number;
   targetChainId: number;
   sourceToken: string;
   targetToken: string;
   sourceAmount: string;
   slippageBps?: number;
}

export interface QuoteResult {
   route: QuoteRoute;
   estimatedOutput: string;
   totalFee: string;
   totalFeeUsd?: string;
}

export class QuoteService {
   private adaptersByChain: Map<number, Map<string, DexAdapter>>;
   private bridgeAdapter: BridgeAdapter;

   constructor() {
      this.adaptersByChain = new Map();
      this.bridgeAdapter = new AcrossAdapter();
   }

   private getAdaptersForChain(chainId: number): Map<string, DexAdapter> {
      const cached = this.adaptersByChain.get(chainId);
      if (cached) return cached;

      const rpcUrl = getRpcUrlForChain(chainId);
      const adapters = new Map<string, DexAdapter>();

      // universal router is the sole adapter -- handles V2 and V3 execution
      // through a single router with Permit2
      if (getUniversalRouterAddress(chainId)) {
         adapters.set(
            'universal-router',
            new UniversalRouterAdapter({
               chainId,
               rpcUrl,
            })
         );
      }

      this.adaptersByChain.set(chainId, adapters);
      return adapters;
   }

   async fetchQuotes(request: QuoteRequest): Promise<QuoteResult[]> {
      logger.info({ request }, 'Fetching quotes');

      const isCrossChain = request.sourceChainId !== request.targetChainId;

      if (isCrossChain) {
         return this.fetchCrossChainQuotes(request);
      } else {
         return this.fetchSameChainQuotes(request);
      }
   }

   private async fetchSameChainQuotes(
      request: QuoteRequest
   ): Promise<QuoteResult[]> {
      const quotes: QuoteResult[] = [];

      const quoteParams = await this.buildQuoteParams(request);
      if (!quoteParams) {
         logger.error({ request }, 'Failed to build quote params');
         return quotes;
      }

      const chainAdapters = this.getAdaptersForChain(request.sourceChainId);
      const adapterNames = [...chainAdapters.keys()];
      const quotePromises = adapterNames.map(async adapterName => {
         try {
            const adapter = chainAdapters.get(adapterName);
            if (!adapter) return null;

            const swapQuote = await adapter.getQuote(quoteParams);
            if (!swapQuote) return null;

            return this.buildQuoteResult(swapQuote, request, adapterName);
         } catch (error: any) {
            logger.error(
               { error, adapter: adapterName },
               `Failed to fetch ${adapterName} quote`
            );
            return null;
         }
      });

      const results = await Promise.all(quotePromises);
      return results.filter((q): q is QuoteResult => q !== null);
   }

   private async fetchCrossChainQuotes(
      request: QuoteRequest
   ): Promise<QuoteResult[]> {
      logger.info({ request }, 'Fetching cross-chain quotes via Across');

      try {
         const bridgeQuote = await this.bridgeAdapter.getQuote({
            sourceChainId: request.sourceChainId,
            destinationChainId: request.targetChainId,
            token: request.sourceToken as Address,
            amount: BigInt(request.sourceAmount),
            recipient: '0x0000000000000000000000000000000000000000' as Address, // placeholder, set at execution time
         });

         if (!bridgeQuote) {
            logger.error({ request }, 'Across bridge returned no quote');
            return [];
         }

         const steps: RouteStep[] = [];

         if (this.needsApproval(request.sourceToken)) {
            steps.push({
               type: RouteStepType.APPROVE,
               chainId: request.sourceChainId,
               protocol: 'erc20',
               fromToken: request.sourceToken,
               toToken: request.sourceToken,
               fromAmount: request.sourceAmount,
               spender: bridgeQuote.spokePoolAddress,
               contractAddress: request.sourceToken,
            });
         }

         steps.push({
            type: RouteStepType.BRIDGE,
            chainId: request.sourceChainId,
            protocol: 'across',
            fromToken: request.sourceToken,
            toToken: request.targetToken,
            fromAmount: request.sourceAmount,
            toAmountMin: bridgeQuote.estimatedOutput.toString(),
            contractAddress: bridgeQuote.spokePoolAddress,
            estimatedGas: bridgeQuote.estimatedGas.toString(),
         });

         const { totalFee, totalFeeUsd, gasPriceGwei } =
            await this.calculateTotalFee(
               bridgeQuote.estimatedGas.toString(),
               '0',
               request.sourceChainId
            );

         return [
            {
               route: {
                  steps,
                  fees: {
                     gasEstimate: bridgeQuote.estimatedGas.toString(),
                     protocolFee: '0',
                     bridgeFee: (
                        bridgeQuote.amount - bridgeQuote.estimatedOutput
                     ).toString(),
                     dexFee: '0',
                  },
                  slippageBps: request.slippageBps || 50,
                  provider: 'across',
                  gasPriceGwei,
                  totalFeeUsd,
               },
               estimatedOutput: bridgeQuote.estimatedOutput.toString(),
               totalFee,
               totalFeeUsd,
            },
         ];
      } catch (error) {
         logger.error({ error }, 'Failed to fetch cross-chain quotes');
         return [];
      }
   }

   private async buildQuoteParams(
      request: QuoteRequest
   ): Promise<QuoteParams | null> {
      try {
         let fromToken = request.sourceToken as Address;
         let toToken = request.targetToken as Address;
         const amount = BigInt(request.sourceAmount);

         const wethAddress = await getWethAddress(request.sourceChainId);
         if (!wethAddress) {
            logger.error(
               { chainId: request.sourceChainId },
               'WETH not configured for chain'
            );
            return null;
         }

         // convert native ETH (zero address) to WETH for quoting --
         // Uniswap pools use WETH, not native ETH
         const NATIVE_ZERO = '0x0000000000000000000000000000000000000000';
         if (fromToken.toLowerCase() === NATIVE_ZERO) {
            fromToken = wethAddress;
         }
         if (toToken.toLowerCase() === NATIVE_ZERO) {
            toToken = wethAddress;
         }

         const isBuy = toToken.toLowerCase() !== wethAddress.toLowerCase();

         return {
            chainId: request.sourceChainId,
            fromToken,
            toToken,
            amount,
            side: isBuy ? 'BUY' : 'SELL',
            slippageBps: request.slippageBps || 50,
         };
      } catch (error: any) {
         logger.error({ error, request }, 'Failed to parse quote params');
         return null;
      }
   }

   private async buildQuoteResult(
      swapQuote: InternalSwapQuote,
      request: QuoteRequest,
      adapterName: string
   ): Promise<QuoteResult> {
      const steps: RouteStep[] = [];

      if (this.needsApproval(request.sourceToken)) {
         const approvalSpender =
            swapQuote.protocol === 'universal-router'
               ? PERMIT2_ADDRESS
               : swapQuote.dexAddress;

         steps.push({
            type: RouteStepType.APPROVE,
            chainId: request.sourceChainId,
            protocol: 'erc20',
            fromToken: request.sourceToken,
            toToken: request.sourceToken,
            fromAmount: request.sourceAmount,
            spender: approvalSpender,
            contractAddress: request.sourceToken,
         });
      }

      const stepCalldata =
         swapQuote.protocol === 'universal-router' && swapQuote.path.encodedPath
            ? swapQuote.path.encodedPath
            : swapQuote.calldata;

      // use the original request tokens (not the adapter's WETH-substituted ones)
      // so the execution service can detect native ETH and use WRAP_ETH
      steps.push({
         type: RouteStepType.SWAP,
         chainId: request.sourceChainId,
         protocol: swapQuote.protocol,
         fromToken: request.sourceToken,
         toToken: request.targetToken,
         fromAmount: swapQuote.fromAmount.toString(),
         toAmountMin: swapQuote.toAmount.toString(),
         contractAddress: swapQuote.dexAddress,
         calldata: stepCalldata,
         estimatedGas: swapQuote.estimatedGas.toString(),
      });

      const { totalFee, totalFeeUsd, gasPriceGwei } =
         await this.calculateTotalFee(
            swapQuote.estimatedGas.toString(),
            swapQuote.fee.toString(),
            request.sourceChainId
         );

      const poolVersion = swapQuote.pool?.version;
      const poolFeeBps = swapQuote.pool?.v3Data
         ? swapQuote.pool.v3Data.fee / 100
         : poolVersion === 'v2'
           ? 30
           : undefined;

      return {
         route: {
            steps,
            fees: {
               gasEstimate: swapQuote.estimatedGas.toString(),
               protocolFee: '0',
               bridgeFee: '0',
               dexFee: swapQuote.fee.toString(),
            },
            slippageBps: request.slippageBps || 50,
            provider: adapterName,
            poolVersion,
            poolFeeBps,
            gasPriceGwei,
            totalFeeUsd,
         },
         estimatedOutput: swapQuote.toAmount.toString(),
         totalFee,
         totalFeeUsd,
      };
   }

   private needsApproval(tokenAddress: string): boolean {
      return tokenAddress !== '0x0000000000000000000000000000000000000000';
   }

   private async calculateTotalFee(
      gasEstimate: string,
      dexFee: string,
      chainId: number
   ): Promise<{
      totalFee: string;
      totalFeeUsd?: string;
      gasPriceGwei: string;
   }> {
      let gasPrice: bigint;
      try {
         const rpcUrl = getRpcUrlForChain(chainId);
         const client = getViemClient(chainId, rpcUrl);
         gasPrice = await client.getGasPrice();
      } catch {
         // fallback to 20 gwei if RPC call fails
         gasPrice = BigInt(20) * BigInt(1e9);
      }

      const gasPriceGwei = formatGwei(gasPrice);

      const gasWei = BigInt(gasEstimate) * gasPrice;
      const total = gasWei + BigInt(dexFee);
      const totalFee = total.toString();

      // convert gas cost to USD
      let totalFeeUsd: string | undefined;
      try {
         const nativePrice = await getNativePriceUsd(chainId);
         if (nativePrice !== null) {
            const feeEth = Number(formatEther(total));
            const feeUsd = feeEth * nativePrice;
            totalFeeUsd = feeUsd.toFixed(2);
         }
      } catch {
         // non-critical, skip USD conversion
      }

      return { totalFee, totalFeeUsd, gasPriceGwei };
   }
}

export function createQuoteService(): QuoteService {
   return new QuoteService();
}

export const quoteService = new QuoteService();
