import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // API Configuration
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000').transform(val => val.split(',')),

  // Database
  DATABASE_URL: z.string(),
  
  // Redis
  REDIS_URL: z.string(),
  
  // Blockchain RPCs
  ETHEREUM_RPC_URL: z.string(),
  BASE_RPC_URL: z.string(),
  ARBITRUM_RPC_URL: z.string(),
  
  // Private Keys (for execution)
  EXECUTOR_PRIVATE_KEY: z.string(),

  // Wallet Encryption
  WALLET_MASTER_KEY: z
    .string()
    .length(64, 'WALLET_MASTER_KEY must be 64 hex characters (32 bytes)'),

  // JWT Authentication
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // External APIs
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  
  // Contract Addresses
  ETHEREUM_SMART_ACCOUNT_FACTORY: z.string().optional(),
  BASE_SMART_ACCOUNT_FACTORY: z.string().optional(),
  ARBITRUM_SMART_ACCOUNT_FACTORY: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export type Config = typeof config;