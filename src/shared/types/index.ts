import { z } from 'zod';

// Chain types
export const ChainSchema = z.enum(['ethereum', 'base', 'arbitrum']);
export type Chain = z.infer<typeof ChainSchema>;

// Intent status types  
export const IntentStatusSchema = z.enum([
  'pending',
  'routing',
  'executing', 
  'completed',
  'failed',
  'cancelled'
]);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

// Intent schema
export const IntentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  sourceChain: ChainSchema,
  targetChain: ChainSchema,
  sourceToken: z.string(), // Token address
  targetToken: z.string(), // Token address
  sourceAmount: z.string(), // BigNumber as string
  minTargetAmount: z.string().optional(), // Minimum acceptable output
  status: IntentStatusSchema,
  route: z.any().optional(), // Execution route details
  txHashes: z.array(z.string()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Intent = z.infer<typeof IntentSchema>;

// Worker job types
export const JobTypeSchema = z.enum([
  'EXECUTE_INTENT',
  'MONITOR_TRANSACTION', 
  'SEND_NOTIFICATION',
  'PROCESS_REFUND'
]);
export type JobType = z.infer<typeof JobTypeSchema>;