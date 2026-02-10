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

const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

const DEPOSIT_ABI = parseAbiItem(
  'function deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes message, uint256 maxCount) external payable'
);

interface SuggestedFeesResponse {
  relayFeePct: string;
  lpFeePct: string;
  timestamp: number;
  isAmountTooLow: boolean;
  spokePoolAddress: string;
}

interface LimitsResponse {
  minDeposit: string;
  maxDeposit: string;
  maxDepositInstant: string;
}

export class AcrossAdapter implements BridgeAdapter {
  async getQuote(params: BridgeQuoteParams): Promise<BridgeQuote | null> {
    try {
      // fetch suggested fees
      const feesUrl = `${ACROSS_API_URL}/suggested-fees?token=${params.token}&originChainId=${params.sourceChainId}&destinationChainId=${params.destinationChainId}&amount=${params.amount.toString()}`;

      const feesResponse = await fetch(feesUrl);
      if (!feesResponse.ok) {
        console.error(`[Across] Fees API error: ${feesResponse.status}`);
        return null;
      }

      const fees: SuggestedFeesResponse = await feesResponse.json();

      if (fees.isAmountTooLow) {
        console.error('[Across] Amount too low for bridge');
        return null;
      }

      // check limits
      const limitsOk = await this.checkLimits(params, params.amount);
      if (!limitsOk) {
        console.error('[Across] Amount outside deposit limits');
        return null;
      }

      // calculate estimated output after fees
      const relayFee = (params.amount * BigInt(fees.relayFeePct)) / BigInt(1e18);
      const lpFee = (params.amount * BigInt(fees.lpFeePct)) / BigInt(1e18);
      const estimatedOutput = params.amount - relayFee - lpFee;

      const spokePool = (fees.spokePoolAddress ||
        SPOKE_POOL_ADDRESSES[params.sourceChainId]) as Address;

      return {
        provider: 'across',
        sourceChainId: params.sourceChainId,
        destinationChainId: params.destinationChainId,
        token: params.token,
        amount: params.amount,
        estimatedOutput,
        relayFeePct: fees.relayFeePct,
        lpFeePct: fees.lpFeePct,
        quoteTimestamp: fees.timestamp,
        spokePoolAddress: spokePool,
        estimatedGas: 200_000n,
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
    const calldata = encodeFunctionData({
      abi: [DEPOSIT_ABI],
      functionName: 'deposit',
      args: [
        sender,
        quote.token,
        quote.amount,
        BigInt(quote.destinationChainId),
        BigInt(quote.relayFeePct),
        quote.quoteTimestamp,
        '0x' as Hex,
        MAX_UINT256,
      ],
    });

    // if token is native ETH (zero address), value = amount
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
      const url = `${ACROSS_API_URL}/limits?token=${params.token}&originChainId=${params.sourceChainId}&destinationChainId=${params.destinationChainId}`;
      const response = await fetch(url);
      if (!response.ok) return false;

      const limits: LimitsResponse = await response.json();
      const min = BigInt(limits.minDeposit);
      const maxInstant = BigInt(limits.maxDepositInstant);

      return amount >= min && amount <= maxInstant;
    } catch {
      // if we can't check limits, allow the transaction
      return true;
    }
  }
}

export function getSpokePoolAddress(chainId: number): Address | null {
  return SPOKE_POOL_ADDRESSES[chainId] || null;
}
