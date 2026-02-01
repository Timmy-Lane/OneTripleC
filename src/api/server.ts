import { fastify } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import { config } from '../shared/config/index.js';
import {
   checkDatabaseHealth,
   closeDatabaseConnection,
   setLogger as setDbLogger,
} from '../persistence/db.js';
import {
   checkRedisHealth,
   closeRedisConnection,
   setLogger as setRedisLogger,
} from '../services/redis.js';
import { registerIntentRoutes } from './routes/intents.js';
import { authRoutes } from './routes/auth.js';
import { walletRoutes } from './routes/wallets.js';
import { executionRoutes } from './routes/executions.js';
import { closeIntentQueue } from '../services/queue.js';
import { createBotService } from '../services/bot.js';
import { createAuthService } from '../domain/auth/auth-service.js';
import { createWalletService } from '../domain/wallet/wallet-service.js';
import { errorHandler } from './middleware/error-handler.js';

const app = fastify({
   logger: {
      level: config.LOG_LEVEL,
   },
   requestIdHeader: 'x-request-id',
   requestIdLogLabel: 'reqId',
   genReqId: () => crypto.randomUUID(),
});

let isShuttingDown = false;
let botService: Awaited<ReturnType<typeof createBotService>> | null = null;

const walletService = createWalletService();
const authService = createAuthService(walletService);

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

function registerHooks() {
   app.addHook('onRequest', async request => {
      request.log.info(
         {
            reqId: request.id,
            method: request.method,
            url: request.url,
         },
         'Request received'
      );
   });

   app.addHook('onResponse', async (request, reply) => {
      request.log.info(
         {
            reqId: request.id,
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            responseTime: reply.elapsedTime,
         },
         'Request completed'
      );
   });
}

function registerErrorHandler() {
   // Use custom error handler that maps domain errors to HTTP responses
   app.setErrorHandler(errorHandler);
}

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
         const errorMessage =
            error instanceof Error ? error.message : String(error);
         app.log.error({ error: errorMessage }, 'Health check failed');
         return reply.status(503).send({
            status: 'unhealthy',
            message: 'Service unhealthy',
         });
      }
   });
}

async function registerApiRoutes() {
   // Auth routes (POST /auth/telegram, GET /auth/me)
   await app.register(authRoutes, { authService });

   // Wallet routes (GET /wallets, GET /wallets/:id)
   await app.register(walletRoutes, { walletService });

   // Execution routes (GET /executions/:id)
   await app.register(executionRoutes);

   // Intent API routes
   await registerIntentRoutes(app);
}

async function gracefulShutdown(signal: string) {
   app.log.info(`${signal} received, starting graceful shutdown...`);
   isShuttingDown = true;

   try {
      await app.close();
      app.log.info('Fastify server closed');

      if (botService) {
         await botService.stop();
         app.log.info('Telegram bot stopped');
      }

      await closeIntentQueue();
      app.log.info('Intent queue closed');

      await closeDatabaseConnection();
      app.log.info('Database connections closed');

      await closeRedisConnection();
      app.log.info('Redis connection closed');

      app.log.info('Graceful shutdown completed');
      process.exit(0);
   } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
   }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', err => {
   app.log.fatal({ err }, 'Uncaught exception');
   gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', reason => {
   app.log.fatal({ reason }, 'Unhandled promise rejection');
   gracefulShutdown('UNHANDLED_REJECTION');
});

const start = async () => {
   try {
      setDbLogger(app.log);
      setRedisLogger(app.log);

      app.log.info('Checking database connection...');
      await checkDatabaseHealth();
      app.log.info('Database connected');

      app.log.info('Checking Redis connection...');
      await checkRedisHealth();
      app.log.info('Redis connected');

      app.log.info('Registering Fastify plugins...');
      await registerPlugins();
      app.log.info('Plugins registered');

      app.log.info('Registering hooks...');
      registerHooks();
      app.log.info('Hooks registered');

      app.log.info('Registering error handler...');
      registerErrorHandler();
      app.log.info('Error handler registered');

      app.log.info('Registering routes...');
      registerRoutes();
      app.log.info('Health routes registered');

      app.log.info('Registering API routes...');
      await registerApiRoutes();
      app.log.info('API routes registered');

      if (config.TELEGRAM_BOT_TOKEN) {
         app.log.info('Starting Telegram bot...');
         botService = await createBotService(
            config.TELEGRAM_BOT_TOKEN,
            authService,
            walletService
         );
         app.log.info('Telegram bot started');
      } else {
         app.log.warn('TELEGRAM_BOT_TOKEN not set, bot will not start');
      }

      await app.listen({ port: config.PORT, host: '0.0.0.0' });
      app.log.info({ port: config.PORT }, 'OneTripleC API listening');
   } catch (err) {
      app.log.fatal({ err }, 'Failed to start server');
      process.exit(1);
   }
};

start();
