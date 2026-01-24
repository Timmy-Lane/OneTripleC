import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

// Job type definitions
export type ParseIntentJobData = {
  intentId: string;
};

export type FetchQuotesJobData = {
  intentId: string;
};

export type IntentJobData = ParseIntentJobData | FetchQuotesJobData;

export const JOB_TYPES = {
  PARSE_INTENT: 'parse-intent',
  FETCH_QUOTES: 'fetch-quotes',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

// Queue name
export const INTENT_QUEUE_NAME = 'intent-queue';

// Simple logger interface
interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const consoleLogger: Logger = {
  info: (obj, msg) => console.log(msg || '', obj),
  error: (obj, msg) => console.error(msg || '', obj),
};

let intentQueue: Queue<IntentJobData> | null = null;
let logger: Logger = consoleLogger;

export function setQueueLogger(loggerInstance: FastifyBaseLogger): void {
  logger = loggerInstance as unknown as Logger;
}

export function getRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
    };
  }
  return {
    host: 'localhost',
    port: 6379,
  };
}

export function getIntentQueue(): Queue<IntentJobData> {
  if (!intentQueue) {
    intentQueue = new Queue<IntentJobData>(INTENT_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });

    intentQueue.on('error', (err) => {
      logger.error({ err }, 'Intent queue error');
    });
  }
  return intentQueue;
}

export async function enqueueParseIntent(intentId: string): Promise<string> {
  const queue = getIntentQueue();
  const job = await queue.add(
    JOB_TYPES.PARSE_INTENT,
    { intentId },
    {
      jobId: `parse-${intentId}`,
    }
  );

  logger.info(
    { intentId, jobId: job.id },
    'Enqueued parse-intent job'
  );

  return job.id!;
}

export async function enqueueFetchQuotes(intentId: string): Promise<string> {
  const queue = getIntentQueue();
  const job = await queue.add(
    JOB_TYPES.FETCH_QUOTES,
    { intentId },
    {
      jobId: `quotes-${intentId}`,
    }
  );

  logger.info(
    { intentId, jobId: job.id },
    'Enqueued fetch-quotes job'
  );

  return job.id!;
}

export async function closeIntentQueue(): Promise<void> {
  if (intentQueue) {
    await intentQueue.close();
    intentQueue = null;
    logger.info('Intent queue closed');
  }
}
