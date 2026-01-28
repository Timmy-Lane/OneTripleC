import { Worker } from 'bullmq';
import { checkDatabaseHealth, closeDatabaseConnection } from '../persistence/db.js';
import { checkRedisHealth, closeRedisConnection } from '../services/redis.js';
import {
  getRedisConnection,
  INTENT_QUEUE_NAME,
  JOB_TYPES,
  type ParseIntentJobData,
  type FetchQuotesJobData,
  closeIntentQueue,
} from '../services/queue.js';
import { intentService } from '../domain/intents/intent-service.js';
import type { Job } from 'bullmq';

type IntentJobData = ParseIntentJobData | FetchQuotesJobData;

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

// Legacy workers for backwards compatibility
// These can be removed once all jobs migrate to intent-queue

type ExecuteIntentJob = {
  intentId: string;
  route: unknown;
};

// intent execution worker (legacy)
const executionWorker = new Worker(
  'intent-execution',
  async (job: Job<ExecuteIntentJob>) => {
    const { intentId } = job.data;
    console.log(`[Legacy Worker] Processing intent execution: ${intentId}`);
    return { success: true, intentId };
  },
  { connection: getRedisConnection(), concurrency: 5 }
);

// tx monitoring worker (legacy)
const monitoringWorker = new Worker(
  'transaction-monitoring',
  async job => {
    const { txHash, chain } = job.data;
    console.log(`[Legacy Worker] Monitoring transaction: ${txHash} on ${chain}`);
    return { success: true, txHash };
  },
  { connection: getRedisConnection(), concurrency: 5 }
);

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
    console.log('[Startup] Job types: parse-intent, fetch-quotes');
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

    await executionWorker.close();
    await monitoringWorker.close();
    console.log('[Shutdown] Legacy workers closed');

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
