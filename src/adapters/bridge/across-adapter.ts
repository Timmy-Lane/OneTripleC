import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseAbiItem,
} from 'viem';
import type { BridgeAdapter, BridgeQuote, BridgeQuoteParams } from './types.js';

const ACROSS_API_URL = 'https://across.to/api';

const SPOKE_POOL_ADDRESSES: Record<number, Address> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
  42161: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a',
  10: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
};

// V3 deposit function
const DEPOSIT_V3_ABI = parseAbiItem(
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable'
);

interface SuggestedFeesResponse {
  relayFeePct: string;
  lpFeePct: string;
  timestamp: string;
  isAmountTooLow: boolean;
  spokePoolAddress: string;
  // V3 fields
  exclusiveRelayer: string;
  exclusivityDeadline: number;
  fillDeadline: string;
  outputAmount: string;
  inputToken: { address: string; symbol: string; decimals: number; chainId: number };
  outputToken: { address: string; symbol: string; decimals: number; chainId: number };
}

interface LimitsResponse {
  minDeposit: string;
  maxDeposit: string;
  maxDepositInstant: string;
}

export class AcrossAdapter implements BridgeAdapter {
  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null> {
    try {
      // use inputToken/outputToken -- the Across API requires these exact param names
      // callers must resolve native ETH (zero address) to WETH before calling
      const feesUrl = `${ACROSS_API_URL}/suggested-fees?inputToken=${params.inputToken}&outputToken=${params.outputToken}&originChainId=${params.sourceChainId}&destinationChainId=${params.destinationChainId}&amount=${params.amount.toString()}`;

      console.log(`[Across] Fetching fees: inputToken=${params.inputToken} outputToken=${params.outputToken} origin=${params.sourceChainId} dest=${params.destinationChainId} amount=${params.amount}`);

      const feesResponse = await fetch(feesUrl, {
        tls: { rejectUnauthorized: false },
      } as any);
      if (!feesResponse.ok) {
        const body = await feesResponse.text().catch(() => '');
        console.error(`[Across] Fees API error: ${feesResponse.status} ${body}`);
        return null;
      }

      const fees: SuggestedFeesResponse = await feesResponse.json();

      if (fees.isAmountTooLow) {
        console.error(`[Across] Amount too low for bridge: ${params.amount}`);
        return null;
      }

      // check limits
      const limitsOk = await this.checkLimits(params, params.amount);
      if (!limitsOk) {
        console.error('[Across] Amount outside deposit limits');
        return null;
      }

      const spokePool = (fees.spokePoolAddress ||
        SPOKE_POOL_ADDRESSES[params.sourceChainId]) as Address;

      // use V3 outputAmount from the API (already accounts for fees)
      const outputAmount = BigInt(fees.outputAmount);

      // derive legacy estimatedOutput for backward compat
      const relayFee = (params.amount * BigInt(fees.relayFeePct)) / BigInt(1e18);
      const lpFee = (params.amount * BigInt(fees.lpFeePct)) / BigInt(1e18);
      const estimatedOutput = params.amount - relayFee - lpFee;

      return {
        provider: 'across',
        sourceChainId: params.sourceChainId,
        destinationChainId: params.destinationChainId,
        token: params.inputToken,
        amount: params.amount,
        estimatedOutput,
        relayFeePct: fees.relayFeePct,
        lpFeePct: fees.lpFeePct,
        quoteTimestamp: Number(fees.timestamp),
        spokePoolAddress: spokePool,
        estimatedGas: 200_000n,
        // V3 fields
        inputToken: fees.inputToken.address as Address,
        outputToken: fees.outputToken.address as Address,
        outputAmount,
        fillDeadline: Number(fees.fillDeadline),
        exclusiveRelayer: (fees.exclusiveRelayer || '0x0000000000000000000000000000000000000000') as Address,
        exclusivityDeadline: fees.exclusivityDeadline || 0,
      };
    } catch (error) {
      console.error('[Across] Error fetching quote:', error);
      return null;
    }
  }

  async buildBridgeTransaction(
    quote: BridgeQuote,
    sender: Address
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    // V3 depositV3 encoding
    const calldata = encodeFunctionData({
      abi: [DEPOSIT_V3_ABI],
      functionName: 'depositV3',
      args: [
        sender, // depositor
        sender, // recipient (same as depositor for self-bridge)
        quote.inputToken, // inputToken (WETH address, not zero)
        quote.outputToken, // outputToken on destination chain
        quote.amount, // inputAmount
        quote.outputAmount, // outputAmount (from API)
        BigInt(quote.destinationChainId),
        quote.exclusiveRelayer,
        quote.quoteTimestamp,
        quote.fillDeadline,
        quote.exclusivityDeadline,
        '0x' as Hex, // empty message
      ],
    });

    // if the original token is native ETH (zero address), send ETH as value
    // the spoke pool wraps it to WETH internally
    const isNative =
      quote.token === '0x0000000000000000000000000000000000000000';

    return {
      to: quote.spokePoolAddress,
      data: calldata,
      value: isNative ? quote.amount : 0n,
    };
  }

  private async checkLimits(
    params: BridgeQuoteParams,
    amount: bigint
  ): Promise<boolean> {
    try {
      const url = `${ACROSS_API_URL}/limits?inputToken=${params.inputToken}&outputToken=${params.outputToken}&originChainId=${params.sourceChainId}&destinationChainId=${params.destinationChainId}`;
      const response = await fetch(url, {
        tls: { rejectUnauthorized: false },
      } as any);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[Across] Limits API error: ${response.status} ${body}`);
        return false;
      }

      const limits: LimitsResponse = await response.json();
      const min = BigInt(limits.minDeposit);
      const maxInstant = BigInt(limits.maxDepositInstant);

      if (amount < min) {
        console.error(`[Across] Amount ${amount} below minimum ${min}`);
        return false;
      }
      if (amount > maxInstant) {
        console.error(`[Across] Amount ${amount} above instant max ${maxInstant}`);
        return false;
      }

      return true;
    } catch {
      // if we can't check limits, allow the transaction
      return true;
    }
  }
}

export function getSpokePoolAddress(chainId: number): Address | null {
  return SPOKE_POOL_ADDRESSES[chainId] || null;
}
