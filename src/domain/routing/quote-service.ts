import type { FastifyBaseLogger } from 'fastify';
import type { QuoteRoute, RouteStep } from '../../shared/types/quote.js';
import { RouteStepType } from '../../shared/types/quote.js';
import { UniswapV2Adapter } from '../../adapters/dex/uniswap-v2-adapter.js';
import { UniswapV3Adapter } from '../../adapters/dex/uniswap-v3-adapter.js';
import type { DexAdapter, QuoteParams, SwapQuote as InternalSwapQuote } from '../../adapters/dex/types.js';
import { Address, parseUnits } from 'viem';
import { WETH } from '../../adapters/tokens/weth.js';

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
}

export interface QuoteServiceConfig {
  chainId: number;
  rpcUrl: string;
}

export class QuoteService {
  private dexAdapters: Map<string, DexAdapter>;
  private chainId: number;
  private rpcUrl: string;

  constructor(config: QuoteServiceConfig) {
    this.chainId = config.chainId;
    this.rpcUrl = config.rpcUrl;
    this.dexAdapters = new Map();
    
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
    logger.info({ request }, 'Cross-chain quotes not yet implemented - returning stub');
    
    return [await this.buildStubCrossChainQuote(request)];
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

  private buildQuoteResult(
    swapQuote: InternalSwapQuote,
    request: QuoteRequest,
    adapterName: string
  ): QuoteResult {
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

    const totalFee = this.calculateTotalFee(
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
    };
  }

  private async buildStubCrossChainQuote(request: QuoteRequest): Promise<QuoteResult> {
    const steps: RouteStep[] = [
      {
        type: RouteStepType.APPROVE,
        chainId: request.sourceChainId,
        protocol: 'erc20',
        fromToken: request.sourceToken,
        toToken: request.sourceToken,
        fromAmount: request.sourceAmount,
        spender: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
        contractAddress: request.sourceToken,
      },
      {
        type: RouteStepType.BRIDGE,
        chainId: request.sourceChainId,
        protocol: 'across',
        fromToken: request.sourceToken,
        toToken: request.targetToken,
        fromAmount: request.sourceAmount,
        toAmountMin: this.estimateOutput(request.sourceAmount, 100),
        contractAddress: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
        estimatedGas: '200000',
      },
    ];

    const estimatedOutput = this.estimateOutput(request.sourceAmount, 100);
    const totalFee = '500000';

    return {
      route: {
        steps,
        fees: {
          gasEstimate: '200000',
          protocolFee: '0',
          bridgeFee: '400000',
          dexFee: '0',
        },
        slippageBps: request.slippageBps || 50,
        provider: 'across',
      },
      estimatedOutput,
      totalFee,
    };
  }

  private needsApproval(tokenAddress: string): boolean {
    return tokenAddress !== '0x0000000000000000000000000000000000000000';
  }

  private estimateOutput(inputAmount: string, slippageBps: number): string {
    const amount = BigInt(inputAmount);
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const estimated = (amount * slippageMultiplier) / BigInt(10000);
    return estimated.toString();
  }

  private calculateTotalFee(gasEstimate: string, dexFee: string): string {
    const gasWei = BigInt(gasEstimate) * BigInt(20) * BigInt(1e9);
    const total = gasWei + BigInt(dexFee);
    return total.toString();
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
