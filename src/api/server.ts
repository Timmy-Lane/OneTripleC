import { fastify } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../shared/config/index.js';
import { checkDatabaseHealth, closeDatabaseConnection } from '../persistence/db.js';
import { checkRedisHealth, closeRedisConnection } from '../services/redis.js';

const app = fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

let isShuttingDown = false;

async function registerPlugins() {
  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });
}

// API docs
// await app.register(swagger, {
//   openapi: {
//     info: {
//       title: 'OneTripleC API',
//       version: '1.0.0',
//     },
//   },
// });

// await app.register(swaggerUi, {
//   routePrefix: '/docs',
// });

function registerRoutes() {
  app.get('/health', async (request, reply) => {
    if (isShuttingDown) {
      return reply.status(503).send({
        status: 'unhealthy',
        message: 'Server is shutting down',
      });
    }

    try {
      await checkDatabaseHealth();
      await checkRedisHealth();

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          redis: 'connected',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      app.log.error({ error: errorMessage }, 'Health check failed');
      return reply.status(503).send({
        status: 'unhealthy',
        message: 'Service unhealthy',
      });
    }
  });
}

// API routes
// TODO: Register route modules here

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received, starting graceful shutdown...`);
  isShuttingDown = true;

  try {
    await app.close();
    console.log('✅ Fastify server closed');

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

const start = async () => {
  try {
    console.log('🔄 Checking database connection...');
    await checkDatabaseHealth();
    console.log('✅ Database connected');

    console.log('🔄 Checking Redis connection...');
    await checkRedisHealth();
    console.log('✅ Redis connected');

    console.log('🔄 Registering Fastify plugins...');
    await registerPlugins();
    console.log('✅ Plugins registered');

    console.log('🔄 Registering routes...');
    registerRoutes();
    console.log('✅ Routes registered');

    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`🚀 OneTripleC API listening on port ${config.PORT}`);
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    app.log.error(err);
    process.exit(1);
  }
};

start();
