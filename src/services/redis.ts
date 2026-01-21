import Redis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';

let redisClient: Redis | null = null;
let logger: FastifyBaseLogger | null = null;

export function setLogger(loggerInstance: FastifyBaseLogger): void {
  logger = loggerInstance;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    redisClient.on('error', (err) => {
      if (logger) {
        logger.error({ err }, 'Redis connection error');
      } else {
        console.error({ err }, 'Redis connection error');
      }
    });

    redisClient.on('connect', () => {
      if (logger) {
        logger.info('Redis connected');
      } else {
        console.log('Redis connected');
      }
    });
  }
  return redisClient;
}

export async function checkRedisHealth(): Promise<void> {
  const client = getRedisClient();
  try {
    await client.ping();
  } catch (error) {
    if (logger) {
      logger.error({ error }, 'Redis health check failed');
    } else {
      console.error({ error }, 'Redis health check failed');
    }
    throw new Error(
      `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
