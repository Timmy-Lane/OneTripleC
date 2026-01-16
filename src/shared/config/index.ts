import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // API Configuration
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().transform(val => val.split(',')).default('http://localhost:3000'),

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
  
  // External APIs
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  
  // Contract Addresses
  ETHEREUM_SMART_ACCOUNT_FACTORY: z.string().optional(),
  BASE_SMART_ACCOUNT_FACTORY: z.string().optional(),
  ARBITRUM_SMART_ACCOUNT_FACTORY: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export type Config = typeof config;