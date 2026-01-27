import {
  Address,
  Hex,
  PublicClient,
  parseAbiItem,
  encodeFunctionData,
  isAddressEqual,
} from 'viem';
import type {
  DexAdapter,
  QuoteParams,
  SwapQuote,
  Pool,
  IntermediatePool,
  SwapPath,
  V2PoolData,
} from './types.js';
import { getViemClient } from '../blockchain/viem-client.js';
import { getRouterAddress } from './utils/index.js';
import { getDeadline } from './utils/deadline.js';
import { WETH } from '../tokens/weth.js';
import { isPairedWithWeth, getOtherToken } from './utils/path-helpers.js';

const PAIR_ABI_GET_RESERVES =
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)';

const ROUTER_ABI_SWAP_EXACT_TOKENS =
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)';

export interface UniswapV2AdapterConfig {
  chainId: number;
  rpcUrl: string;
}

export class UniswapV2Adapter implements DexAdapter {
  private readonly chainId: number;
  private readonly client: PublicClient;

  constructor(config: UniswapV2AdapterConfig) {
    this.chainId = config.chainId;
    this.client = getViemClient(config.chainId, config.rpcUrl);
  }

  async getQuote(params: QuoteParams): Promise<SwapQuote | null> {
    const { fromToken, toToken, amount, side } = params;

    const routerAddress = getRouterAddress('uniswap', 'v2', this.chainId);
    if (!routerAddress) {
      console.error(
        `[UniswapV2Adapter] No router for chain ${this.chainId}`
      );
      return null;
    }

    const pathResult = this.buildPath(params);
    if (!pathResult) {
      console.error(
        `[UniswapV2Adapter] Failed to build path for ${fromToken} -> ${toToken}`
      );
      return null;
    }

    const { path, pool, intermediatePool } = pathResult;

    const reserves = await this.fetchReserves(path.pools);
    if (!reserves) {
      console.error(
        `[UniswapV2Adapter] Failed to fetch reserves for pool ${pool.address}`
      );
      return null;
    }

    try {
      const amountOut = this.calculateAmountOut(
        amount,
        side,
        path.pools,
        reserves
      );

      const swapQuote: SwapQuote = {
        fromToken,
        toToken,
        fromAmount: amount,
        toAmount: amountOut,
        protocol: 'uniswap-v2',
        dexAddress: routerAddress,
        calldata: '0x',
        estimatedGas: this.estimateGas(path.pools.length),
        fee: this.estimateFee(amount),
        path,
        pool,
        ...(intermediatePool && { intermediatePool }),
      };

      return swapQuote;
    } catch (error: any) {
      console.error(
        `[UniswapV2Adapter] Quote calculation failed:`,
        error.message
      );
      return null;
    }
  }

  async buildSwapTransaction(
    quote: SwapQuote,
    recipient: Address,
    slippageBps: number
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
    const deadline = getDeadline(20);

    const path = quote.path.tokens;

    const calldata = encodeFunctionData({
      abi: [parseAbiItem(ROUTER_ABI_SWAP_EXACT_TOKENS)],
      functionName: 'swapExactTokensForTokens',
      args: [quote.fromAmount, minAmountOut, path, recipient, deadline],
    });

    return {
      to: quote.dexAddress,
      data: calldata,
      value: 0n,
    };
  }

  private async fetchReserves(
    pools: Pool[]
  ): Promise<Map<Address, V2PoolData> | null> {
    const reservesMap = new Map<Address, V2PoolData>();

    try {
      const multicallResults = await this.client.multicall({
        contracts: pools.map((pool) => ({
          address: pool.address,
          abi: [parseAbiItem(PAIR_ABI_GET_RESERVES)],
          functionName: 'getReserves',
        })),
      });

      for (let i = 0; i < pools.length; i++) {
        const result = multicallResults[i];
        if (result.status === 'failure' || !Array.isArray(result.result)) {
          console.error(
            `[UniswapV2Adapter] Failed to fetch reserves for pool ${pools[i].address}`
          );
          return null;
        }

        reservesMap.set(pools[i].address, {
          reserve0: result.result[0],
          reserve1: result.result[1],
        });
      }

      return reservesMap;
    } catch (error: any) {
      console.error(
        `[UniswapV2Adapter] Multicall failed:`,
        error.message
      );
      return null;
    }
  }

  private calculateAmountOut(
    amountIn: bigint,
    side: 'BUY' | 'SELL',
    pools: Pool[],
    reservesMap: Map<Address, V2PoolData>
  ): bigint {
    let currentAmount = amountIn;

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const reserves = reservesMap.get(pool.address);
      if (!reserves) {
        throw new Error(`Missing reserves for pool ${pool.address}`);
      }

      const orderedReserves = this.orderReserves(
        pool,
        reserves,
        i === 0 ? (side === 'BUY' ? pool.token0 : pool.token1) : pool.token0
      );

      currentAmount = this.calculateSingleHopOut(
        currentAmount,
        orderedReserves
      );
    }

    return currentAmount;
  }

  private calculateSingleHopOut(
    amountIn: bigint,
    reserves: V2PoolData
  ): bigint {
    const fee = 3n;
    const multiplier = 1000n;

    const amountInWithFee = amountIn * (multiplier - fee);
    const numerator = amountInWithFee * reserves.reserve1;
    const denominator = reserves.reserve0 * multiplier + amountInWithFee;

    return numerator / denominator;
  }

  private orderReserves(
    pool: Pool,
    reserves: V2PoolData,
    inputToken: Address
  ): V2PoolData {
    if (isAddressEqual(pool.token0, inputToken)) {
      return reserves;
    }
    return {
      reserve0: reserves.reserve1,
      reserve1: reserves.reserve0,
    };
  }

  private buildPath(params: QuoteParams): {
    path: SwapPath;
    pool: Pool;
    intermediatePool?: IntermediatePool;
  } | null {
    const { fromToken, toToken, side, intermediateTokens } = params;

    const wethAddress = WETH.getAddress(this.chainId);
    if (!wethAddress) {
      return null;
    }

    const isSingleHop = isPairedWithWeth(fromToken, toToken, this.chainId);

    if (isSingleHop) {
      return this.buildSingleHopPath(fromToken, toToken);
    }

    return this.buildMultiHopPath(
      fromToken,
      toToken,
      wethAddress,
      intermediateTokens
    );
  }

  private buildSingleHopPath(
    fromToken: Address,
    toToken: Address
  ): {
    path: SwapPath;
    pool: Pool;
  } | null {
    const poolAddress = this.derivePoolAddress(fromToken, toToken);

    const pool: Pool = {
      address: poolAddress,
      token0: fromToken,
      token1: toToken,
      dex: 'uniswap',
      version: 'v2',
      chainId: this.chainId,
    };

    const path: SwapPath = {
      pools: [pool],
      tokens: [fromToken, toToken],
    };

    return { path, pool };
  }

  private buildMultiHopPath(
    fromToken: Address,
    toToken: Address,
    wethAddress: Address,
    intermediateTokens?: Address[]
  ): {
    path: SwapPath;
    pool: Pool;
    intermediatePool: IntermediatePool;
  } | null {
    let intermediateToken: Address;

    if (intermediateTokens && intermediateTokens.length > 0) {
      intermediateToken = intermediateTokens[0];
    } else {
      intermediateToken = wethAddress;
    }

    const pool1Address = this.derivePoolAddress(fromToken, intermediateToken);
    const pool2Address = this.derivePoolAddress(intermediateToken, toToken);

    const pool1: Pool = {
      address: pool1Address,
      token0: fromToken,
      token1: intermediateToken,
      dex: 'uniswap',
      version: 'v2',
      chainId: this.chainId,
    };

    const pool2: IntermediatePool = {
      address: pool2Address,
      token0: intermediateToken,
      token1: toToken,
      dex: 'uniswap',
      version: 'v2',
      chainId: this.chainId,
      isIntermediate: true,
    };

    const path: SwapPath = {
      pools: [pool1, pool2],
      tokens: [fromToken, intermediateToken, toToken],
    };

    return {
      path,
      pool: pool1,
      intermediatePool: pool2,
    };
  }

  private derivePoolAddress(tokenA: Address, tokenB: Address): Address {
    const [token0, token1] =
      tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

    return `${token0.slice(0, 10)}...${token1.slice(-6)}` as Address;
  }

  private estimateGas(hops: number): bigint {
    const baseGas = 100000n;
    const perHopGas = 50000n;
    return baseGas + perHopGas * BigInt(hops - 1);
  }

  private estimateFee(amount: bigint): bigint {
    return (amount * 3n) / 1000n;
  }

  private applySlippage(amount: bigint, slippageBps: number): bigint {
    const slippageMultiplier = BigInt(10000 - slippageBps);
    return (amount * slippageMultiplier) / 10000n;
  }
}
