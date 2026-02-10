import {
   Address,
   Hex,
   PublicClient,
   parseAbiItem,
   encodeFunctionData,
   isAddressEqual,
   numberToHex,
   pad,
} from 'viem';
import type {
   DexAdapter,
   QuoteParams,
   SwapQuote,
   Pool,
   IntermediatePool,
   SwapPath,
   V3PoolData,
} from './types.js';
import { getViemClient } from '../blockchain/viem-client.js';
import { getRouterAddress, getQuoterAddress } from './utils/index.js';
import { getDeadline } from './utils/deadline.js';
import { WETH } from '../tokens/weth.js';
import { isPairedWithWeth, getOtherToken } from './utils/path-helpers.js';

// function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint16[] memory fees)
const QUOTER_ABI_EXACT_INPUT =
   'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)';

const ROUTER_ABI_EXACT_INPUT =
   'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)';

export interface UniswapV3AdapterConfig {
   chainId: number;
   rpcUrl: string;
}

export class UniswapV3Adapter implements DexAdapter {
   private readonly chainId: number;
   private readonly client: PublicClient;

   constructor(config: UniswapV3AdapterConfig) {
      this.chainId = config.chainId;
      this.client = getViemClient(config.chainId, config.rpcUrl);
   }

   async getQuote(params: QuoteParams): Promise<SwapQuote | null> {
      const { fromToken, toToken, amount, side } = params;

      const quoterAddress = getQuoterAddress('uniswap', this.chainId);
      if (!quoterAddress) {
         console.error(
            `[UniswapV3Adapter] No quoter for chain ${this.chainId}`
         );
         return null;
      }

      const routerAddress = getRouterAddress('uniswap', 'v3', this.chainId);
      if (!routerAddress) {
         console.error(
            `[UniswapV3Adapter] No router for chain ${this.chainId}`
         );
         return null;
      }

      const pathResult = this.buildPath(params);
      if (!pathResult) {
         console.error(
            `[UniswapV3Adapter] Failed to build path for ${fromToken} -> ${toToken}`
         );
         return null;
      }

      const { encodedPath, path, pool, intermediatePool } = pathResult;

      try {
         const { result } = await this.client.simulateContract({
            address: quoterAddress,
            abi: [parseAbiItem(QUOTER_ABI_EXACT_INPUT)],
            functionName: 'quoteExactInput',
            args: [encodedPath, amount],
         });

         const amountOut = result[0] as bigint;
         const gasEstimate = result[3] as bigint;

         const swapQuote: SwapQuote = {
            fromToken,
            toToken,
            fromAmount: amount,
            toAmount: amountOut,
            protocol: 'uniswap-v3',
            dexAddress: routerAddress,
            calldata: '0x', // Will be built in buildSwapTransaction
            estimatedGas: gasEstimate,
            fee: this.estimateFee(pool),
            path,
            pool,
            ...(intermediatePool && { intermediatePool }),
         };

         return swapQuote;
      } catch (error: any) {
         console.error(
            `[UniswapV3Adapter] Quote failed for pool ${pool.address}:`,
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

      const encodedPath = quote.path.encodedPath;
      if (!encodedPath) {
         throw new Error('[UniswapV3Adapter] Missing encoded path in quote');
      }

      const calldata = encodeFunctionData({
         abi: [parseAbiItem(ROUTER_ABI_EXACT_INPUT)],
         functionName: 'exactInput',
         args: [
            {
               path: encodedPath,
               recipient,
               deadline,
               amountIn: quote.fromAmount,
               amountOutMinimum: minAmountOut,
            },
         ],
      });

      return {
         to: quote.dexAddress,
         data: calldata,
         value: 0n, // ETH wrapping handled separately
      };
   }

   private buildPath(params: QuoteParams): {
      encodedPath: Hex;
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
         return this.buildSingleHopPath(fromToken, toToken, side);
      }

      return this.buildMultiHopPath(
         fromToken,
         toToken,
         wethAddress,
         side,
         intermediateTokens
      );
   }

   private buildSingleHopPath(
      fromToken: Address,
      toToken: Address,
      side: 'BUY' | 'SELL'
   ): {
      encodedPath: Hex;
      path: SwapPath;
      pool: Pool;
   } | null {
      const fee = 3000; // Default 0.3% tier
      const poolAddress = this.derivePoolAddress(fromToken, toToken, fee);

      const pool: Pool = {
         address: poolAddress,
         token0: fromToken,
         token1: toToken,
         dex: 'uniswap',
         version: 'v3',
         chainId: this.chainId,
         v3Data: { fee },
      };

      const encodedPath = this.encodePath([fromToken, toToken], [fee]);

      const path: SwapPath = {
         pools: [pool],
         tokens: [fromToken, toToken],
         encodedPath,
      };

      return { encodedPath, path, pool };
   }

   private buildMultiHopPath(
      fromToken: Address,
      toToken: Address,
      wethAddress: Address,
      side: 'BUY' | 'SELL',
      intermediateTokens?: Address[]
   ): {
      encodedPath: Hex;
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

      const fee1 = 3000;
      const fee2 = 3000;

      const pool1Address = this.derivePoolAddress(
         fromToken,
         intermediateToken,
         fee1
      );
      const pool2Address = this.derivePoolAddress(
         intermediateToken,
         toToken,
         fee2
      );

      const pool1: Pool = {
         address: pool1Address,
         token0: fromToken,
         token1: intermediateToken,
         dex: 'uniswap',
         version: 'v3',
         chainId: this.chainId,
         v3Data: { fee: fee1 },
      };

      const pool2: IntermediatePool = {
         address: pool2Address,
         token0: intermediateToken,
         token1: toToken,
         dex: 'uniswap',
         version: 'v3',
         chainId: this.chainId,
         v3Data: { fee: fee2 },
         isIntermediate: true,
      };

      const encodedPath = this.encodePath(
         [fromToken, intermediateToken, toToken],
         [fee1, fee2]
      );

      const path: SwapPath = {
         pools: [pool1, pool2],
         tokens: [fromToken, intermediateToken, toToken],
         encodedPath,
      };

      return {
         encodedPath,
         path,
         pool: pool1,
         intermediatePool: pool2,
      };
   }

   private encodePath(tokens: Address[], fees: number[]): Hex {
      if (tokens.length !== fees.length + 1) {
         throw new Error(
            '[UniswapV3Adapter] Invalid path: tokens.length must equal fees.length + 1'
         );
      }

      let encoded = tokens[0].toLowerCase();

      for (let i = 0; i < fees.length; i++) {
         const hexFee = pad(numberToHex(fees[i]), { size: 3 }).slice(2);
         const nextToken = tokens[i + 1].slice(2).toLowerCase();
         encoded += hexFee + nextToken;
      }

      return encoded as Hex;
   }

   private derivePoolAddress(
      tokenA: Address,
      tokenB: Address,
      fee: number
   ): Address {
      const [token0, token1] =
         tokenA.toLowerCase() < tokenB.toLowerCase()
            ? [tokenA, tokenB]
            : [tokenB, tokenA];

      return `${token0.slice(0, 10)}...${token1.slice(-6)}:${fee}` as Address;
   }

   private estimateFee(pool: Pool): bigint {
      const v3Data = pool.v3Data;
      if (!v3Data) {
         return 0n;
      }
      return BigInt(v3Data.fee);
   }

   private applySlippage(amount: bigint, slippageBps: number): bigint {
      const slippageMultiplier = BigInt(10000 - slippageBps);
      return (amount * slippageMultiplier) / 10000n;
   }
}
