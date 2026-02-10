import type { FastifyBaseLogger } from 'fastify';
import type { QuoteRoute, RouteStep } from '../../shared/types/quote.js';
import { RouteStepType } from '../../shared/types/quote.js';
import { UniswapV2Adapter } from '../../adapters/dex/uniswap-v2-adapter.js';
import { UniswapV3Adapter } from '../../adapters/dex/uniswap-v3-adapter.js';
import type { DexAdapter, QuoteParams, SwapQuote as InternalSwapQuote } from '../../adapters/dex/types.js';
import { Address, formatEther } from 'viem';
import { WETH } from '../../adapters/tokens/weth.js';
import { getViemClient } from '../../adapters/blockchain/viem-client.js';
import { getNativePriceUsd } from '../../adapters/coingecko/index.js';
import { AcrossAdapter } from '../../adapters/bridge/across-adapter.js';
import type { BridgeAdapter } from '../../adapters/bridge/types.js';

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

export interface QuoteServiceConfig {
  chainId: number;
  rpcUrl: string;
}

export class QuoteService {
  private dexAdapters: Map<string, DexAdapter>;
  private bridgeAdapter: BridgeAdapter;
  private chainId: number;
  private rpcUrl: string;

  constructor(config: QuoteServiceConfig) {
    this.chainId = config.chainId;
    this.rpcUrl = config.rpcUrl;
    this.dexAdapters = new Map();
    this.bridgeAdapter = new AcrossAdapter();

    this.dexAdapters.set('uniswap-v2', new UniswapV2Adapter({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
    }));

    this.dexAdapters.set('uniswap-v3', new UniswapV3Adapter({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
    }));
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

  private async fetchSameChainQuotes(request: QuoteRequest): Promise<QuoteResult[]> {
    const quotes: QuoteResult[] = [];

    const quoteParams = this.buildQuoteParams(request);
    if (!quoteParams) {
      logger.error({ request }, 'Failed to build quote params');
      return quotes;
    }

    const adapters = ['uniswap-v2', 'uniswap-v3'];
    const quotePromises = adapters.map(async (adapterName) => {
      try {
        const adapter = this.dexAdapters.get(adapterName);
        if (!adapter) return null;

        const swapQuote = await adapter.getQuote(quoteParams);
        if (!swapQuote) return null;

        return this.buildQuoteResult(swapQuote, request, adapterName);
      } catch (error: any) {
        logger.error({ error, adapter: adapterName }, `Failed to fetch ${adapterName} quote`);
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    return results.filter((q): q is QuoteResult => q !== null);
  }

  private async fetchCrossChainQuotes(request: QuoteRequest): Promise<QuoteResult[]> {
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

      const { totalFee, totalFeeUsd } = await this.calculateTotalFee(
        bridgeQuote.estimatedGas.toString(),
        '0'
      );

      return [{
        route: {
          steps,
          fees: {
            gasEstimate: bridgeQuote.estimatedGas.toString(),
            protocolFee: '0',
            bridgeFee: (bridgeQuote.amount - bridgeQuote.estimatedOutput).toString(),
            dexFee: '0',
          },
          slippageBps: request.slippageBps || 50,
          provider: 'across',
        },
        estimatedOutput: bridgeQuote.estimatedOutput.toString(),
        totalFee,
        totalFeeUsd,
      }];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch cross-chain quotes');
      return [];
    }
  }

  private buildQuoteParams(request: QuoteRequest): QuoteParams | null {
    try {
      const fromToken = request.sourceToken as Address;
      const toToken = request.targetToken as Address;
      const amount = BigInt(request.sourceAmount);

      const wethAddress = WETH.getAddress(request.sourceChainId);
      if (!wethAddress) {
        logger.error({ chainId: request.sourceChainId }, 'WETH not configured for chain');
        return null;
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
      steps.push({
        type: RouteStepType.APPROVE,
        chainId: request.sourceChainId,
        protocol: 'erc20',
        fromToken: request.sourceToken,
        toToken: request.sourceToken,
        fromAmount: request.sourceAmount,
        spender: swapQuote.dexAddress,
        contractAddress: request.sourceToken,
      });
    }

    steps.push({
      type: RouteStepType.SWAP,
      chainId: request.sourceChainId,
      protocol: swapQuote.protocol,
      fromToken: swapQuote.fromToken,
      toToken: swapQuote.toToken,
      fromAmount: swapQuote.fromAmount.toString(),
      toAmountMin: swapQuote.toAmount.toString(),
      contractAddress: swapQuote.dexAddress,
      calldata: swapQuote.calldata,
      estimatedGas: swapQuote.estimatedGas.toString(),
    });

    const { totalFee, totalFeeUsd } = await this.calculateTotalFee(
      swapQuote.estimatedGas.toString(),
      swapQuote.fee.toString()
    );

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
    dexFee: string
  ): Promise<{ totalFee: string; totalFeeUsd?: string }> {
    let gasPrice: bigint;
    try {
      const client = getViemClient(this.chainId, this.rpcUrl);
      gasPrice = await client.getGasPrice();
    } catch {
      // fallback to 20 gwei if RPC call fails
      gasPrice = BigInt(20) * BigInt(1e9);
    }

    const gasWei = BigInt(gasEstimate) * gasPrice;
    const total = gasWei + BigInt(dexFee);
    const totalFee = total.toString();

    // convert gas cost to USD
    let totalFeeUsd: string | undefined;
    try {
      const nativePrice = await getNativePriceUsd(this.chainId);
      if (nativePrice !== null) {
        const feeEth = Number(formatEther(total));
        const feeUsd = feeEth * nativePrice;
        totalFeeUsd = feeUsd.toFixed(2);
      }
    } catch {
      // non-critical, skip USD conversion
    }

    return { totalFee, totalFeeUsd };
  }
}

export function createQuoteService(config: QuoteServiceConfig): QuoteService {
  return new QuoteService(config);
}

// Default singleton instance for backwards compatibility
export const quoteService = new QuoteService({
  chainId: 1,
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
});
