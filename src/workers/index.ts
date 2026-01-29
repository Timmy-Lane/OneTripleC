import { Worker } from 'bullmq';
import { checkDatabaseHealth, closeDatabaseConnection } from '../persistence/db.js';
import { checkRedisHealth, closeRedisConnection } from '../services/redis.js';
import {
  getRedisConnection,
  INTENT_QUEUE_NAME,
  JOB_TYPES,
  type ParseIntentJobData,
  type FetchQuotesJobData,
  type ExecuteIntentJobData,
  type MonitorTxJobData,
  closeIntentQueue,
  enqueueMonitorTx,
} from '../services/queue.js';
import { intentService } from '../domain/intents/intent-service.js';
import { createWalletService } from '../domain/wallet/wallet-service.js';
import { createExecutionService } from '../domain/execution/execution-service.js';
import { updateExecutionState } from '../persistence/repositories/execution-repository.js';
import { ExecutionState } from '../shared/types/index.js';
import { createPublicClient, http } from 'viem';
import { mainnet, base, arbitrum, optimism, polygon } from 'viem/chains';
import type { Job } from 'bullmq';

type IntentJobData =
  | ParseIntentJobData
  | FetchQuotesJobData
  | ExecuteIntentJobData
  | MonitorTxJobData;

// Initialize services
const walletService = createWalletService();
const executionService = createExecutionService(walletService);

// Chain configs
const VIEM_CHAINS: Record<number, any> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
  137: polygon,
};

function getRpcUrl(chainId: number): string {
  switch (chainId) {
    case 1:
      return process.env.ETHEREUM_RPC_URL!;
    case 8453:
      return process.env.BASE_RPC_URL!;
    case 42161:
      return process.env.ARBITRUM_RPC_URL!;
    case 10:
      return process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io';
    case 137:
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    default:
      throw new Error(`RPC URL not configured for chain: ${chainId}`);
  }
}

// Intent queue worker - processes parse-intent and fetch-quotes jobs
const intentWorker = new Worker<IntentJobData>(
  INTENT_QUEUE_NAME,
  async (job: Job<IntentJobData>) => {
    const startTime = Date.now();
    console.log(`[Worker] Starting job: ${job.name} (${job.id})`);

    try {
      switch (job.name) {
        case JOB_TYPES.PARSE_INTENT: {
          const { intentId } = job.data as ParseIntentJobData;
          console.log(`[Worker] Processing parse-intent for: ${intentId}`);

          const result = await intentService.parseIntent(intentId);

          console.log(
            `[Worker] parse-intent completed for ${intentId}: state=${result.state}`
          );
          return {
            success: true,
            intentId,
            state: result.state,
            duration: Date.now() - startTime,
          };
        }

        case JOB_TYPES.FETCH_QUOTES: {
          const { intentId } = job.data as FetchQuotesJobData;
          console.log(`[Worker] Processing fetch-quotes for: ${intentId}`);

          const result = await intentService.fetchQuotesForIntent(intentId);

          console.log(
            `[Worker] fetch-quotes completed for ${intentId}: quotes=${result.quotesCreated}, state=${result.state}`
          );
          return {
            success: true,
            intentId,
            quotesCreated: result.quotesCreated,
            state: result.state,
            duration: Date.now() - startTime,
          };
        }

        case JOB_TYPES.EXECUTE_INTENT: {
          const { executionId } = job.data as ExecuteIntentJobData;
          console.log(`[Worker] Processing execute-intent for: ${executionId}`);

          const result = await executionService.executeIntent(executionId);

          // Enqueue monitoring job
          if (result.txHash) {
            await enqueueMonitorTx(executionId, result.txHash, result.chainId);
          }

          console.log(
            `[Worker] execute-intent completed for ${executionId}: txHash=${result.txHash}`
          );
          return {
            success: true,
            executionId,
            txHash: result.txHash,
            chainId: result.chainId,
            duration: Date.now() - startTime,
          };
        }

        case JOB_TYPES.MONITOR_TX: {
          const { executionId, txHash, chainId } = job.data as MonitorTxJobData;
          console.log(
            `[Worker] Monitoring transaction: ${txHash} on chain ${chainId}`
          );

          // Get RPC client
          const chain = VIEM_CHAINS[chainId];
          if (!chain) {
            throw new Error(`Unsupported chain: ${chainId}`);
          }

          const rpcUrl = getRpcUrl(chainId);
          const client = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          // Check transaction receipt
          const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

          if (receipt.status === 'success') {
            await updateExecutionState(executionId, ExecutionState.CONFIRMED, {
              confirmedAt: new Date(),
            });

            console.log(
              `[Worker] Transaction confirmed: ${txHash} at block ${receipt.blockNumber}`
            );
            return {
              success: true,
              status: 'confirmed',
              blockNumber: receipt.blockNumber.toString(),
              duration: Date.now() - startTime,
            };
          } else {
            await updateExecutionState(executionId, ExecutionState.FAILED, {
              errorMessage: 'Transaction reverted',
            });
            throw new Error(`Transaction reverted: ${txHash}`);
          }
        }

        default:
          console.warn(`[Worker] Unknown job type: ${job.name}`);
          return { success: false, error: `Unknown job type: ${job.name}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Worker] Job ${job.name} (${job.id}) failed:`, errorMessage);

      // For parse-intent jobs, try to mark the intent as failed
      if (job.name === JOB_TYPES.PARSE_INTENT) {
        try {
          const { intentId } = job.data as ParseIntentJobData;
          await intentService.markFailed(intentId, `Worker error: ${errorMessage}`);
        } catch (markError) {
          console.error('[Worker] Failed to mark intent as failed:', markError);
        }
      }

      throw error;
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  }
);

// Worker event handlers
intentWorker.on('completed', (job) => {
  console.log(`[Worker] Job completed: ${job.name} (${job.id})`);
});

intentWorker.on('failed', (job, error) => {
  console.error(`[Worker] Job failed: ${job?.name} (${job?.id})`, error.message);
});

intentWorker.on('error', (error) => {
  console.error('[Worker] Worker error:', error);
});

// Legacy workers removed - all jobs now use intent-queue

async function startWorkers() {
  try {
    console.log('[Startup] Checking database connection...');
    await checkDatabaseHealth();
    console.log('[Startup] Database connected');

    console.log('[Startup] Checking Redis connection...');
    await checkRedisHealth();
    console.log('[Startup] Redis connected');

    console.log('[Startup] OneTripleC workers started');
    console.log(`[Startup] Intent queue worker listening on: ${INTENT_QUEUE_NAME}`);
    console.log(
      '[Startup] Job types: parse-intent, fetch-quotes, execute-intent, monitor-tx'
    );
  } catch (err) {
    console.error('[Startup] Failed to start workers:', err);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] ${signal} received, shutting down workers...`);

  try {
    await intentWorker.close();
    console.log('[Shutdown] Intent worker closed');

    await closeIntentQueue();
    console.log('[Shutdown] Intent queue closed');

    await closeDatabaseConnection();
    console.log('[Shutdown] Database connections closed');

    await closeRedisConnection();
    console.log('[Shutdown] Redis connection closed');

    console.log('[Shutdown] Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startWorkers();
