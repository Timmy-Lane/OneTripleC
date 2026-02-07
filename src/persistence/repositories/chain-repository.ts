import { db } from '../db.js';
import { chains } from '../models/schema.js';
import { eq } from 'drizzle-orm';

export interface Chain {
  id: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string | null;
  nativeToken: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function findChainById(chainId: number): Promise<Chain | null> {
  const [chain] = await db
    .select()
    .from(chains)
    .where(eq(chains.id, chainId))
    .limit(1);

  return chain || null;
}

export async function findAllChains(): Promise<Chain[]> {
  return db.select().from(chains);
}

export async function findActiveChains(): Promise<Chain[]> {
  return db
    .select()
    .from(chains)
    .where(eq(chains.isActive, true));
}

export async function findChainByName(name: string): Promise<Chain | null> {
  const [chain] = await db
    .select()
    .from(chains)
    .where(eq(chains.name, name))
    .limit(1);

  return chain || null;
}

export async function updateChainRpcUrl(
  chainId: number,
  rpcUrl: string
): Promise<Chain | null> {
  const [updated] = await db
    .update(chains)
    .set({ rpcUrl, updatedAt: new Date() })
    .where(eq(chains.id, chainId))
    .returning();

  return updated || null;
}

export async function setChainActive(
  chainId: number,
  isActive: boolean
): Promise<Chain | null> {
  const [updated] = await db
    .update(chains)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(chains.id, chainId))
    .returning();

  return updated || null;
}

export async function createChain(input: {
  id: number;
  name: string;
  rpcUrl?: string;
  explorerUrl?: string;
  nativeToken: string;
  isActive?: boolean;
}): Promise<Chain> {
  const [chain] = await db
    .insert(chains)
    .values({
      id: input.id,
      name: input.name,
      rpcUrl: input.rpcUrl || '',
      explorerUrl: input.explorerUrl,
      nativeToken: input.nativeToken,
      isActive: input.isActive ?? true,
    })
    .returning();

  return chain;
}

export async function isChainSupported(chainId: number): Promise<boolean> {
  const chain = await findChainById(chainId);
  return chain !== null && chain.isActive;
}
