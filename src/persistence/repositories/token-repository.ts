import { db } from '../db.js';
import { tokens } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';

export interface Token {
  id: string;
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  createdAt: Date;
}

export async function findTokensByChainId(chainId: number): Promise<Token[]> {
  return db
    .select()
    .from(tokens)
    .where(eq(tokens.chainId, chainId));
}

export async function findTokenByChainAndAddress(
  chainId: number,
  address: string
): Promise<Token | null> {
  const [token] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.chainId, chainId), eq(tokens.address, address)))
    .limit(1);

  return token || null;
}

export async function findAllTokens(): Promise<Token[]> {
  return db.select().from(tokens);
}

export async function createToken(input: {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}): Promise<Token> {
  const [token] = await db
    .insert(tokens)
    .values({
      chainId: input.chainId,
      address: input.address,
      symbol: input.symbol,
      decimals: input.decimals,
    })
    .returning();

  return token;
}
