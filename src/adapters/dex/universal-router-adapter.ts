import {
   Address,
   Hex,
   PublicClient,
   parseAbiItem,
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
} from './types.js';
import { getViemClient } from '../blockchain/viem-client.js';
import { getQuoterAddress } from './utils/index.js';
import { getDeadline } from './utils/deadline.js';
import { WETH } from '../tokens/weth.js';
import { isPairedWithWeth } from './utils/path-helpers.js';
import {
   getUniversalRouterAddress,
   UR_COMMAND,
   UR_RECIPIENT_ROUTER,
} from './universal-router/index.js';
import {
   encodeCommands,
   encodeV3SwapExactIn,
   encodeUnwrapWeth,
   encodeExecute,
} from './universal-router/index.js';

const QUOTER_ABI_EXACT_INPUT =
   'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)';

// extra gas overhead for universal router command dispatch vs direct v3 router
const UR_GAS_OVERHEAD = 30000n;

export interface UniversalRouterAdapterConfig {
   chainId: number;
   rpcUrl: string;
}

export class UniversalRouterAdapter implements DexAdapter {
   private readonly chainId: number;
   private readonly client: PublicClient;
   private readonly routerAddress: Address;

   constructor(config: UniversalRouterAdapterConfig) {
      this.chainId = config.chainId;
      this.client = getViemClient(config.chainId, config.rpcUrl);

      const addr = getUniversalRouterAddress(config.chainId);
      if (!addr) {
         throw new Error(
            `[UniversalRouterAdapter] Not deployed on chain ${config.chainId}`
         );
      }
      this.routerAddress = addr;
   }

   // -- quoting: same as v3 adapter, uses v3 Quoter contract --

   async getQuote(params: QuoteParams): Promise<SwapQuote | null> {
      const { fromToken, toToken, amount } = params;

      const quoterAddress = getQuoterAddress('uniswap', this.chainId);
      if (!quoterAddress) {
         console.error(
            `[UniversalRouterAdapter] No quoter for chain ${this.chainId}`
         );
         return null;
      }

      const pathResult = this.buildPath(params);
      if (!pathResult) {
         console.error(
            `[UniversalRouterAdapter] Failed to build path for ${fromToken} -> ${toToken}`
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
         const gasEstimate = (result[3] as bigint) + UR_GAS_OVERHEAD;

         const swapQuote: SwapQuote = {
            fromToken,
            toToken,
            fromAmount: amount,
            toAmount: amountOut,
            protocol: 'universal-router',
            dexAddress: this.routerAddress,
            calldata: '0x', // built in buildSwapTransaction
            estimatedGas: gasEstimate,
            fee: this.estimateFee(pool),
            path,
            pool,
            ...(intermediatePool && { intermediatePool }),
         };

         return swapQuote;
      } catch (error: any) {
         console.error(
            `[UniversalRouterAdapter] Quote failed for pool ${pool.address}:`,
            error.message
         );
         return null;
      }
   }

   // -- execution: encodes for universal router execute() --

   async buildSwapTransaction(
      quote: SwapQuote,
      recipient: Address,
      slippageBps: number
   ): Promise<{ to: Address; data: Hex; value: bigint }> {
      const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
      const deadline = getDeadline(20);

      const encodedPath = quote.path.encodedPath;
      if (!encodedPath) {
         throw new Error(
            '[UniversalRouterAdapter] Missing encoded path in quote'
         );
      }

      // check if output is WETH -- if so, unwrap to native ETH
      const wethAddress = WETH.getAddress(this.chainId);
      const outputIsWeth =
         wethAddress &&
         quote.toToken.toLowerCase() === wethAddress.toLowerCase();

      const commandList: Array<{ id: number; allowRevert?: boolean }> = [];
      const inputs: Hex[] = [];

      // command 1: V3_SWAP_EXACT_IN
      commandList.push({ id: UR_COMMAND.V3_SWAP_EXACT_IN });
      inputs.push(
         encodeV3SwapExactIn({
            // if unwrapping, swap output goes to router first
            recipient: outputIsWeth
               ? UR_RECIPIENT_ROUTER
               : recipient,
            amountIn: quote.fromAmount,
            amountOutMin: minAmountOut,
            path: encodedPath,
            payerIsUser: true, // tokens come from msg.sender via permit2
         })
      );

      // command 2 (optional): UNWRAP_WETH if output is native ETH
      if (outputIsWeth) {
         commandList.push({ id: UR_COMMAND.UNWRAP_WETH });
         inputs.push(
            encodeUnwrapWeth({
               recipient,
               amountMin: minAmountOut,
            })
         );
      }

      const commands = encodeCommands(commandList);
      const data = encodeExecute(commands, inputs, deadline);

      return {
         to: this.routerAddress,
         data,
         value: 0n,
      };
   }

   // -- path building (same as v3 adapter) --

   private buildPath(params: QuoteParams): {
      encodedPath: Hex;
      path: SwapPath;
      pool: Pool;
      intermediatePool?: IntermediatePool;
   } | null {
      const { fromToken, toToken, intermediateTokens } = params;

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
      encodedPath: Hex;
      path: SwapPath;
      pool: Pool;
   } | null {
      const fee = 3000;
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
      intermediateTokens?: Address[]
   ): {
      encodedPath: Hex;
      path: SwapPath;
      pool: Pool;
      intermediatePool: IntermediatePool;
   } | null {
      const intermediateToken =
         intermediateTokens && intermediateTokens.length > 0
            ? intermediateTokens[0]
            : wethAddress;

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

   // -- utilities --

   private encodePath(tokens: Address[], fees: number[]): Hex {
      if (tokens.length !== fees.length + 1) {
         throw new Error(
            '[UniversalRouterAdapter] Invalid path: tokens.length must equal fees.length + 1'
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
      if (!v3Data) return 0n;
      return BigInt(v3Data.fee);
   }

   private applySlippage(amount: bigint, slippageBps: number): bigint {
      const slippageMultiplier = BigInt(10000 - slippageBps);
      return (amount * slippageMultiplier) / 10000n;
   }
}
