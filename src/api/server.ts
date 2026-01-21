import { fastify } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../shared/config/index.js';

const app = fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

await app.register(helmet);
await app.register(cors, {
  origin: config.CORS_ORIGINS,
});
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// API docs
await app.register(swagger, {
  openapi: {
    info: {
      title: 'OneTripleC API',
      version: '1.0.0',
    },
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
});

// Health check
app.get('/health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// API routes
// TODO: Register route modules here

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`🚀 OneTripleC API listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
