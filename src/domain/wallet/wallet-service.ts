import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  createWallet,
  findWalletByUserId,
  findActiveWalletByUserId,
  findAllWalletsByUserId,
  findWalletById,
  deleteWalletById,
  setWalletActive,
} from '../../persistence/repositories/wallet-repository.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

interface EncryptedData {
  encryptedData: string;
  iv: string;
  authTag: string;
}

interface WalletInfo {
  id: string;
  userId: string;
  address: string;
  isActive: boolean;
}

export interface WalletService {
  generateWalletForUser(userId: string): Promise<{
    id: string;
    address: string;
  }>;
  getWalletByUserId(userId: string): Promise<{
    id: string;
    userId: string;
    address: string;
  } | null>;
  getActiveWalletByUserId(userId: string): Promise<WalletInfo | null>;
  getAllWalletsByUserId(userId: string): Promise<WalletInfo[]>;
  getWalletById(id: string): Promise<{
    id: string;
    userId: string;
    address: string;
  } | null>;
  getPrivateKey(walletId: string): Promise<Hex>;
  deleteWallet(walletId: string, userId: string): Promise<boolean>;
  setActiveWallet(walletId: string, userId: string): Promise<boolean>;
}

export function createWalletService(): WalletService {
  const masterKey = getMasterKey();

  function getMasterKey(): Buffer {
    const keyHex = process.env.WALLET_MASTER_KEY;
    if (!keyHex) {
      throw new Error('WALLET_MASTER_KEY environment variable is required');
    }
    if (keyHex.length !== 64) {
      throw new Error('WALLET_MASTER_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
  }

  function encryptPrivateKey(privateKey: Hex): EncryptedData {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, masterKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(privateKey, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encryptedData: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  function decryptPrivateKey(encrypted: EncryptedData): Hex {
    const decipher = createDecipheriv(
      ALGORITHM,
      masterKey,
      Buffer.from(encrypted.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedData, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8') as Hex;
  }

  async function generateWalletForUser(userId: string): Promise<{
    id: string;
    address: string;
  }> {
    // generate keypair
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // encrypt private key
    const encrypted = encryptPrivateKey(privateKey);

    // deactivate existing wallets for the user
    const existingWallets = await findAllWalletsByUserId(userId);
    if (existingWallets.length > 0) {
      for (const w of existingWallets) {
        await setWalletActive(w.id, userId);
      }
    }

    // store wallet (new wallets default to active)
    const wallet = await createWallet({
      userId,
      address: account.address,
      encryptedPrivateKey: JSON.stringify(encrypted),
      encryptionKeyId: 'master-key-v1',
    });

    return {
      id: wallet.id,
      address: wallet.address,
    };
  }

  async function getWalletByUserId(userId: string) {
    // prefer active wallet, fall back to any wallet
    const activeWallet = await findActiveWalletByUserId(userId);
    const wallet = activeWallet || await findWalletByUserId(userId);
    if (!wallet) {
      return null;
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      address: wallet.address,
    };
  }

  async function getActiveWalletByUserId(userId: string): Promise<WalletInfo | null> {
    const wallet = await findActiveWalletByUserId(userId);
    if (!wallet) {
      // fall back to first wallet
      const fallback = await findWalletByUserId(userId);
      if (!fallback) return null;
      return {
        id: fallback.id,
        userId: fallback.userId,
        address: fallback.address,
        isActive: fallback.isActive,
      };
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      address: wallet.address,
      isActive: wallet.isActive,
    };
  }

  async function getAllWalletsByUserId(userId: string): Promise<WalletInfo[]> {
    const allWallets = await findAllWalletsByUserId(userId);
    return allWallets.map(w => ({
      id: w.id,
      userId: w.userId,
      address: w.address,
      isActive: w.isActive,
    }));
  }

  async function getWalletById(id: string) {
    const wallet = await findWalletById(id);
    if (!wallet) {
      return null;
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      address: wallet.address,
    };
  }

  async function getPrivateKey(walletId: string): Promise<Hex> {
    const wallet = await findWalletById(walletId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const encrypted: EncryptedData = JSON.parse(wallet.encryptedPrivateKey);
    return decryptPrivateKey(encrypted);
  }

  async function deleteWalletFn(walletId: string, userId: string): Promise<boolean> {
    const allWallets = await findAllWalletsByUserId(userId);
    if (allWallets.length <= 1) {
      throw new Error('Cannot delete the only wallet');
    }

    const wallet = allWallets.find(w => w.id === walletId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    await deleteWalletById(walletId);

    // if the deleted wallet was active, activate the first remaining wallet
    if (wallet.isActive) {
      const remaining = allWallets.filter(w => w.id !== walletId);
      if (remaining.length > 0) {
        await setWalletActive(remaining[0].id, userId);
      }
    }

    return true;
  }

  async function setActiveWalletFn(walletId: string, userId: string): Promise<boolean> {
    const result = await setWalletActive(walletId, userId);
    return result !== null;
  }

  return {
    generateWalletForUser,
    getWalletByUserId,
    getActiveWalletByUserId,
    getAllWalletsByUserId,
    getWalletById,
    getPrivateKey,
    deleteWallet: deleteWalletFn,
    setActiveWallet: setActiveWalletFn,
  };
}
