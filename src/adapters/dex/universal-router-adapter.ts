import {
   Address,
   Hex,
   PublicClient,
   parseAbiItem,
   numberToHex,
   pad,
   isAddress,
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
   PERMIT2_ADDRESS,
   UR_COMMAND,
   FeeAmount,
   UR_RECIPIENT_ROUTER,
   UR_RECIPIENT_SENDER,
   encodeCommands,
   encodeV3SwapExactIn,
   encodeV2SwapExactIn,
   encodeUnwrapWeth,
   encodePermit2Permit,
   encodeExecute,
   signPermit2,
   getPermit2Nonce,
} from './universal-router/index.js';
import type { Permit2PermitParams } from './universal-router/types.js';

const QUOTER_ABI_EXACT_INPUT =
   'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)';

// extra gas overhead for universal router command dispatch vs direct v3 router
const UR_GAS_OVERHEAD = 30000n;

// fee tiers to try when quoting, ordered by most common first
const FEE_TIERS = [FeeAmount.MEDIUM, FeeAmount.LOW, FeeAmount.HIGH, FeeAmount.LOWEST];

// deadline bounds in minutes
const MAX_DEADLINE_MINUTES = 30;
const MIN_DEADLINE_MINUTES = 2;
const DEFAULT_DEADLINE_MINUTES = 20;

// slippage bounds in bps
const MAX_SLIPPAGE_BPS = 5000; // 50%
const MIN_SLIPPAGE_BPS = 0;

export interface UniversalRouterAdapterConfig {
   chainId: number;
   rpcUrl: string;
}

type QuoteAttempt = {
   amountOut: bigint;
   gasEstimate: bigint;
   feeTier: number;
   feeTier2?: number;
   encodedPath: Hex;
   path: SwapPath;
   pool: Pool;
   intermediatePool?: IntermediatePool;
};

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

   // -- phase 4a: multi-fee-tier quoting --
   // tries multiple fee tiers in parallel and returns the best output

   async getQuote(params: QuoteParams): Promise<SwapQuote | null> {
      const { fromToken, toToken, amount } = params;

      this.validateQuoteParams(params);

      const quoterAddress = getQuoterAddress('uniswap', this.chainId);
      if (!quoterAddress) {
         console.error(
            `[UniversalRouterAdapter] No quoter for chain ${this.chainId}`
         );
         return null;
      }

      const wethAddress = WETH.getAddress(this.chainId);
      if (!wethAddress) {
         return null;
      }

      const isSingleHop = isPairedWithWeth(fromToken, toToken, this.chainId);
      const intermediateTokens = params.intermediateTokens;

      const attempts: Promise<QuoteAttempt | null>[] = [];

      if (isSingleHop) {
         for (const fee of FEE_TIERS) {
            attempts.push(
               this.tryQuote(quoterAddress, fromToken, toToken, amount, fee)
            );
         }
      } else {
         const intermediateToken =
            intermediateTokens && intermediateTokens.length > 0
               ? intermediateTokens[0]
               : wethAddress;

         // common fee tier combos for multi-hop
         const multiHopFees: [number, number][] = [
            [FeeAmount.MEDIUM, FeeAmount.MEDIUM],
            [FeeAmount.LOW, FeeAmount.MEDIUM],
            [FeeAmount.MEDIUM, FeeAmount.LOW],
            [FeeAmount.LOW, FeeAmount.LOW],
         ];

         for (const [fee1, fee2] of multiHopFees) {
            attempts.push(
               this.tryMultiHopQuote(
                  quoterAddress, fromToken, intermediateToken, toToken,
                  amount, fee1, fee2
               )
            );
         }
      }

      const results = await Promise.all(attempts);
      const successful = results.filter((r): r is QuoteAttempt => r !== null);

      if (successful.length === 0) {
         console.error(
            `[UniversalRouterAdapter] All fee tier attempts failed for ${fromToken} -> ${toToken}`
         );
         return null;
      }

      // pick best output amount
      const best = successful.reduce((a, b) =>
         a.amountOut > b.amountOut ? a : b
      );

      const swapQuote: SwapQuote = {
         fromToken,
         toToken,
         fromAmount: amount,
         toAmount: best.amountOut,
         protocol: 'universal-router',
         dexAddress: this.routerAddress,
         calldata: '0x', // built in buildSwapTransaction
         estimatedGas: best.gasEstimate + UR_GAS_OVERHEAD,
         fee: this.estimateFee(best.pool),
         path: best.path,
         pool: best.pool,
         ...(best.intermediatePool && { intermediatePool: best.intermediatePool }),
      };

      return swapQuote;
   }

   private async tryQuote(
      quoterAddress: Address,
      fromToken: Address,
      toToken: Address,
      amount: bigint,
      fee: number
   ): Promise<QuoteAttempt | null> {
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

      try {
         const { result } = await this.client.simulateContract({
            address: quoterAddress,
            abi: [parseAbiItem(QUOTER_ABI_EXACT_INPUT)],
            functionName: 'quoteExactInput',
            args: [encodedPath, amount],
         });
         return {
            amountOut: result[0] as bigint,
            gasEstimate: result[3] as bigint,
            feeTier: fee,
            encodedPath,
            path,
            pool,
         };
      } catch {
         return null;
      }
   }

   private async tryMultiHopQuote(
      quoterAddress: Address,
      fromToken: Address,
      intermediateToken: Address,
      toToken: Address,
      amount: bigint,
      fee1: number,
      fee2: number
   ): Promise<QuoteAttempt | null> {
      const pool1Address = this.derivePoolAddress(fromToken, intermediateToken, fee1);
      const pool2Address = this.derivePoolAddress(intermediateToken, toToken, fee2);

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

      try {
         const { result } = await this.client.simulateContract({
            address: quoterAddress,
            abi: [parseAbiItem(QUOTER_ABI_EXACT_INPUT)],
            functionName: 'quoteExactInput',
            args: [encodedPath, amount],
         });
         return {
            amountOut: result[0] as bigint,
            gasEstimate: result[3] as bigint,
            feeTier: fee1,
            feeTier2: fee2,
            encodedPath,
            path,
            pool: pool1,
            intermediatePool: pool2,
         };
      } catch {
         return null;
      }
   }

   // -- execution: encodes V3 swap for universal router execute() --

   async buildSwapTransaction(
      quote: SwapQuote,
      recipient: Address,
      slippageBps: number
   ): Promise<{ to: Address; data: Hex; value: bigint }> {
      this.validateBuildParams(recipient, slippageBps);

      const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
      const deadline = getDeadline(DEFAULT_DEADLINE_MINUTES);

      const encodedPath = quote.path.encodedPath;
      if (!encodedPath) {
         throw new Error(
            '[UniversalRouterAdapter] Missing encoded path in quote'
         );
      }

      const outputIsWeth = this.isOutputWeth(quote.toToken);

      const commandList: Array<{ id: number; allowRevert?: boolean }> = [];
      const inputs: Hex[] = [];

      // command 1: V3_SWAP_EXACT_IN
      commandList.push({ id: UR_COMMAND.V3_SWAP_EXACT_IN });
      inputs.push(
         encodeV3SwapExactIn({
            recipient: outputIsWeth ? UR_RECIPIENT_ROUTER : recipient,
            amountIn: quote.fromAmount,
            amountOutMin: minAmountOut,
            path: encodedPath,
            payerIsUser: true,
         })
      );

      // command 2 (optional): UNWRAP_WETH if output is native ETH
      if (outputIsWeth) {
         commandList.push({ id: UR_COMMAND.UNWRAP_WETH });
         inputs.push(
            encodeUnwrapWeth({ recipient, amountMin: minAmountOut })
         );
      }

      const commands = encodeCommands(commandList);
      const data = encodeExecute(commands, inputs, deadline);

      return { to: this.routerAddress, data, value: 0n };
   }

   // -- phase 4b: V2 swap via universal router --

   async buildV2SwapTransaction(
      quote: SwapQuote,
      recipient: Address,
      slippageBps: number
   ): Promise<{ to: Address; data: Hex; value: bigint }> {
      this.validateBuildParams(recipient, slippageBps);

      const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
      const deadline = getDeadline(DEFAULT_DEADLINE_MINUTES);

      const outputIsWeth = this.isOutputWeth(quote.toToken);

      const commandList: Array<{ id: number; allowRevert?: boolean }> = [];
      const inputs: Hex[] = [];

      // command 1: V2_SWAP_EXACT_IN
      commandList.push({ id: UR_COMMAND.V2_SWAP_EXACT_IN });
      inputs.push(
         encodeV2SwapExactIn({
            recipient: outputIsWeth ? UR_RECIPIENT_ROUTER : recipient,
            amountIn: quote.fromAmount,
            amountOutMin: minAmountOut,
            path: quote.path.tokens,
            payerIsUser: true,
         })
      );

      // command 2 (optional): UNWRAP_WETH if output is native ETH
      if (outputIsWeth) {
         commandList.push({ id: UR_COMMAND.UNWRAP_WETH });
         inputs.push(
            encodeUnwrapWeth({ recipient, amountMin: minAmountOut })
         );
      }

      const commands = encodeCommands(commandList);
      const data = encodeExecute(commands, inputs, deadline);

      return { to: this.routerAddress, data, value: 0n };
   }

   // -- execution with permit2 signature --

   async buildSwapWithPermit(
      quote: SwapQuote,
      recipient: Address,
      slippageBps: number,
      signTypedData: (params: any) => Promise<Hex>
   ): Promise<{ to: Address; data: Hex; value: bigint }> {
      this.validateBuildParams(recipient, slippageBps);

      const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
      const deadline = getDeadline(DEFAULT_DEADLINE_MINUTES);

      const encodedPath = quote.path.encodedPath;
      if (!encodedPath) {
         throw new Error(
            '[UniversalRouterAdapter] Missing encoded path in quote'
         );
      }

      // fetch current nonce from Permit2 contract
      const { nonce } = await getPermit2Nonce(
         this.client.readContract.bind(this.client),
         recipient,
         quote.fromToken,
         this.routerAddress
      );

      // build permit params
      const permit: Permit2PermitParams = {
         token: quote.fromToken,
         amount: quote.fromAmount,
         expiration: Math.floor(Date.now() / 1000) + 86400, // 24h
         nonce,
         spender: this.routerAddress,
         sigDeadline: deadline,
      };

      // sign the permit via the caller-provided signing function
      const signature = await signPermit2(
         signTypedData,
         this.chainId,
         permit
      );

      const outputIsWeth = this.isOutputWeth(quote.toToken);

      const commandList: Array<{ id: number; allowRevert?: boolean }> = [];
      const inputs: Hex[] = [];

      // command 1: PERMIT2_PERMIT
      commandList.push({ id: UR_COMMAND.PERMIT2_PERMIT });
      inputs.push(encodePermit2Permit(permit, signature));

      // command 2: V3_SWAP_EXACT_IN
      commandList.push({ id: UR_COMMAND.V3_SWAP_EXACT_IN });
      inputs.push(
         encodeV3SwapExactIn({
            recipient: outputIsWeth ? UR_RECIPIENT_ROUTER : recipient,
            amountIn: quote.fromAmount,
            amountOutMin: minAmountOut,
            path: encodedPath,
            payerIsUser: true,
         })
      );

      // command 3 (optional): UNWRAP_WETH if output is native ETH
      if (outputIsWeth) {
         commandList.push({ id: UR_COMMAND.UNWRAP_WETH });
         inputs.push(
            encodeUnwrapWeth({ recipient, amountMin: minAmountOut })
         );
      }

      const commands = encodeCommands(commandList);
      const data = encodeExecute(commands, inputs, deadline);

      return { to: this.routerAddress, data, value: 0n };
   }

   // -- V2 swap with permit2 --

   async buildV2SwapWithPermit(
      quote: SwapQuote,
      recipient: Address,
      slippageBps: number,
      signTypedData: (params: any) => Promise<Hex>
   ): Promise<{ to: Address; data: Hex; value: bigint }> {
      this.validateBuildParams(recipient, slippageBps);

      const minAmountOut = this.applySlippage(quote.toAmount, slippageBps);
      const deadline = getDeadline(DEFAULT_DEADLINE_MINUTES);

      const { nonce } = await getPermit2Nonce(
         this.client.readContract.bind(this.client),
         recipient,
         quote.fromToken,
         this.routerAddress
      );

      const permit: Permit2PermitParams = {
         token: quote.fromToken,
         amount: quote.fromAmount,
         expiration: Math.floor(Date.now() / 1000) + 86400,
         nonce,
         spender: this.routerAddress,
         sigDeadline: deadline,
      };

      const signature = await signPermit2(
         signTypedData,
         this.chainId,
         permit
      );

      const outputIsWeth = this.isOutputWeth(quote.toToken);

      const commandList: Array<{ id: number; allowRevert?: boolean }> = [];
      const inputs: Hex[] = [];

      commandList.push({ id: UR_COMMAND.PERMIT2_PERMIT });
      inputs.push(encodePermit2Permit(permit, signature));

      commandList.push({ id: UR_COMMAND.V2_SWAP_EXACT_IN });
      inputs.push(
         encodeV2SwapExactIn({
            recipient: outputIsWeth ? UR_RECIPIENT_ROUTER : recipient,
            amountIn: quote.fromAmount,
            amountOutMin: minAmountOut,
            path: quote.path.tokens,
            payerIsUser: true,
         })
      );

      if (outputIsWeth) {
         commandList.push({ id: UR_COMMAND.UNWRAP_WETH });
         inputs.push(
            encodeUnwrapWeth({ recipient, amountMin: minAmountOut })
         );
      }

      const commands = encodeCommands(commandList);
      const data = encodeExecute(commands, inputs, deadline);

      return { to: this.routerAddress, data, value: 0n };
   }

   // -- accessor methods for execution service --

   getRouterAddress(): Address {
      return this.routerAddress;
   }

   getPermit2Address(): Address {
      return PERMIT2_ADDRESS;
   }

   getChainId(): number {
      return this.chainId;
   }

   // -- phase 5: input validation --

   private validateQuoteParams(params: QuoteParams): void {
      if (params.amount <= 0n) {
         throw new Error('[UniversalRouterAdapter] Amount must be greater than zero');
      }
      if (params.fromToken.toLowerCase() === params.toToken.toLowerCase()) {
         throw new Error('[UniversalRouterAdapter] fromToken and toToken must be different');
      }
   }

   private validateBuildParams(recipient: Address, slippageBps: number): void {
      if (recipient === '0x0000000000000000000000000000000000000000') {
         throw new Error('[UniversalRouterAdapter] Recipient cannot be zero address');
      }
      if (slippageBps < MIN_SLIPPAGE_BPS || slippageBps > MAX_SLIPPAGE_BPS) {
         throw new Error(
            `[UniversalRouterAdapter] Slippage must be between ${MIN_SLIPPAGE_BPS} and ${MAX_SLIPPAGE_BPS} bps`
         );
      }
   }

   private isOutputWeth(toToken: Address): boolean {
      const wethAddress = WETH.getAddress(this.chainId);
      return !!wethAddress && toToken.toLowerCase() === wethAddress.toLowerCase();
   }

   // -- path building --

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
