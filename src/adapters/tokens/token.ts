import { Address, formatUnits, parseUnits } from 'viem';

export interface TokenConfig {
  address: Address;
  decimals: number;
  symbol: string;
  chainId: number;
}

export class Token {
  public readonly address: Address;
  public readonly decimals: number;
  public readonly symbol: string;
  public readonly chainId: number;

  constructor(config: TokenConfig) {
    this.address = config.address;
    this.decimals = config.decimals;
    this.symbol = config.symbol;
    this.chainId = config.chainId;
  }

  public addDecimals(amount: number): bigint {
    return parseUnits(amount.toString(), this.decimals);
  }

  public subtractDecimals(amount: bigint): number {
    const formatted = formatUnits(amount, this.decimals);
    return Number(formatted);
  }

  public formatAmount(amount: bigint, precision: number = 6): string {
    const formatted = formatUnits(amount, this.decimals);
    const number = Number(formatted);
    return number.toFixed(precision);
  }

  public isNative(): boolean {
    return this.address === '0x0000000000000000000000000000000000000000';
  }
}
