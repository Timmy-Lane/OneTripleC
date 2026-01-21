import { Worker } from 'bullmq';
import { checkDatabaseHealth, closeDatabaseConnection } from '../persistence/db.js';
import { checkRedisHealth, closeRedisConnection } from '../services/redis.js';
import type { ConnectionOptions, Job } from 'bullmq';

type ExecuteIntentJob = {
  intentId: string;
  route: unknown;
};

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
  port: process.env.REDIS_URL ? parseInt(new URL(process.env.REDIS_URL).port || '6379') : 6379,
};

// intent execution worker
const executionWorker = new Worker(
  'intent-execution',
  async (job: Job<ExecuteIntentJob>) => {
    const { intentId } = job.data;
    console.log(`Processing intent execution: ${intentId}`);

    return { success: true, intentId };
  },
  { connection: redisConnection, concurrency: 5 }
);

// tx monitoring worker
const monitoringWorker = new Worker(
  'transaction-monitoring',
  async job => {
    const { txHash, chain } = job.data;
    console.log(`Monitoring transaction: ${txHash} on ${chain}`);

    // TODO: Implement transaction monitoring
    // 1. Check transaction status
    // 2. Update intent if confirmed
    // 3. Handle failures/retries

    return { success: true, txHash };
  },
  { connection: redisConnection, concurrency: 5 }
);

async function startWorkers() {
  try {
    console.log('🔄 Checking database connection...');
    await checkDatabaseHealth();
    console.log('✅ Database connected');

    console.log('🔄 Checking Redis connection...');
    await checkRedisHealth();
    console.log('✅ Redis connected');

    console.log('🚀 OneTripleC workers started');
  } catch (err) {
    console.error('❌ Failed to start workers:', err);
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received, shutting down workers...`);

  try {
    await executionWorker.close();
    await monitoringWorker.close();
    console.log('✅ Workers closed');

    await closeDatabaseConnection();
    console.log('✅ Database connections closed');

    await closeRedisConnection();
    console.log('✅ Redis connection closed');

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startWorkers();
