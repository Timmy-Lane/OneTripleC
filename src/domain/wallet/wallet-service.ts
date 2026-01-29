import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  createWallet,
  findWalletByUserId,
  findWalletById,
  findWalletByAddress,
} from '../../persistence/repositories/wallet-repository.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

interface EncryptedData {
  encryptedData: string;
  iv: string;
  authTag: string;
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
  getWalletById(id: string): Promise<{
    id: string;
    userId: string;
    address: string;
  } | null>;
  getPrivateKey(walletId: string): Promise<Hex>;
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
    // Check if wallet already exists
    const existingWallet = await findWalletByUserId(userId);
    if (existingWallet) {
      throw new Error('Wallet already exists for this user');
    }

    // Generate keypair
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Encrypt private key
    const encrypted = encryptPrivateKey(privateKey);

    // Store wallet
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
    const wallet = await findWalletByUserId(userId);
    if (!wallet) {
      return null;
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      address: wallet.address,
    };
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

  return {
    generateWalletForUser,
    getWalletByUserId,
    getWalletById,
    getPrivateKey,
  };
}
