import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../shared/config/index.js';
import * as schema from './models/schema.js';

let pool: Pool | null = null;
let logger: FastifyBaseLogger | null = null;

export function setLogger(loggerInstance: FastifyBaseLogger): void {
  logger = loggerInstance;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      if (logger) {
        logger.error({ err }, 'Unexpected database pool error');
      } else {
        console.error({ err }, 'Unexpected database pool error');
      }
    });
  }
  return pool;
}

export const db = drizzle(getPool(), { schema });

export async function checkDatabaseHealth(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
  } catch (error) {
    if (logger) {
      logger.error({ error }, 'Database health check failed');
    } else {
      console.error({ error }, 'Database health check failed');
    }
    throw new Error(
      `Database connection failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    client.release();
  }
}

export async function closeDatabaseConnection(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
