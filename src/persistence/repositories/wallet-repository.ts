import { db } from '../db.js';
import { wallets } from '../models/schema.js';
import { eq } from 'drizzle-orm';

export interface CreateWalletInput {
  userId: string;
  address: string;
  encryptedPrivateKey: string;
  encryptionKeyId?: string;
}

export async function createWallet(input: CreateWalletInput) {
  const [wallet] = await db
    .insert(wallets)
    .values({
      userId: input.userId,
      address: input.address,
      encryptedPrivateKey: input.encryptedPrivateKey,
      encryptionKeyId: input.encryptionKeyId || 'master-key-v1',
    })
    .returning();

  return wallet;
}

export async function findWalletByUserId(userId: string) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  return wallet || null;
}

export async function findWalletById(id: string) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, id))
    .limit(1);

  return wallet || null;
}

export async function findWalletByAddress(address: string) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.address, address))
    .limit(1);

  return wallet || null;
}
