import { db } from '../db.js';
import { wallets } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';

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
      isActive: true,
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

export async function findActiveWalletByUserId(userId: string) {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.isActive, true)))
    .limit(1);

  return wallet || null;
}

export async function findAllWalletsByUserId(userId: string) {
  return db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId));
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

export async function deleteWalletById(id: string) {
  const [deleted] = await db
    .delete(wallets)
    .where(eq(wallets.id, id))
    .returning();

  return deleted || null;
}

export async function setWalletActive(walletId: string, userId: string) {
  // deactivate all wallets for the user
  await db
    .update(wallets)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(wallets.userId, userId));

  // activate the selected wallet
  const [updated] = await db
    .update(wallets)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(wallets.id, walletId))
    .returning();

  return updated || null;
}
