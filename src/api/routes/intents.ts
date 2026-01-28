import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { intentService, setIntentServiceLogger } from '../../domain/intents/intent-service.js';
import { setQueueLogger } from '../../services/queue.js';
import { findQuotesByIntentId, markQuoteAccepted } from '../../persistence/repositories/quote-repository.js';

// Request schemas
const createIntentSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  rawMessage: z.string().min(1, 'rawMessage is required').max(2000, 'rawMessage too long'),
});

const intentIdParamSchema = z.object({
  id: z.string().uuid('Intent ID must be a valid UUID'),
});

type CreateIntentBody = z.infer<typeof createIntentSchema>;
type IntentIdParams = z.infer<typeof intentIdParamSchema>;

export async function registerIntentRoutes(app: FastifyInstance): Promise<void> {
  // Inject logger into services
  setIntentServiceLogger(app.log);
  setQueueLogger(app.log);

  /**
   * POST /intents
   * Create a new intent from raw message.
   *
   * Request body:
   *   - userId: string (UUID)
   *   - rawMessage: string (user's natural language intent)
   *
   * Response:
   *   - id: string (intent UUID)
   *   - state: string (CREATED)
   *   - createdAt: string (ISO timestamp)
   */
  app.post<{ Body: CreateIntentBody }>(
    '/intents',
    async (request: FastifyRequest<{ Body: CreateIntentBody }>, reply: FastifyReply) => {
      request.log.info({ body: request.body }, 'POST /intents received');

      // Validate request body
      const parseResult = createIntentSchema.safeParse(request.body);
      if (!parseResult.success) {
        request.log.warn(
          { errors: parseResult.error.flatten() },
          'Invalid request body'
        );
        return reply.status(400).send({
          error: {
            message: 'Invalid request body',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            details: parseResult.error.flatten().fieldErrors,
          },
        });
      }

      const { userId, rawMessage } = parseResult.data;

      try {
        const intent = await intentService.createIntent({
          userId,
          rawMessage,
        });

        request.log.info(
          { intentId: intent.id, state: intent.state },
          'Intent created successfully'
        );

        return reply.status(201).send({
          id: intent.id,
          state: intent.state,
          createdAt: intent.createdAt,
        });
      } catch (error) {
        request.log.error({ error }, 'Failed to create intent');

        // Check for specific error types
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Foreign key violation (user doesn't exist)
        if (errorMessage.includes('violates foreign key constraint')) {
          return reply.status(400).send({
            error: {
              message: 'User not found',
              code: 'USER_NOT_FOUND',
              statusCode: 400,
            },
          });
        }

        throw error;
      }
    }
  );

  /**
   * GET /intents/:id
   * Retrieve an intent by ID.
   *
   * Path params:
   *   - id: string (UUID)
   *
   * Response:
   *   - Full intent object including current state
   */
  app.get<{ Params: IntentIdParams }>(
    '/intents/:id',
    async (request: FastifyRequest<{ Params: IntentIdParams }>, reply: FastifyReply) => {
      request.log.info({ intentId: request.params.id }, 'GET /intents/:id received');

      // Validate params
      const parseResult = intentIdParamSchema.safeParse(request.params);
      if (!parseResult.success) {
        request.log.warn(
          { errors: parseResult.error.flatten() },
          'Invalid intent ID'
        );
        return reply.status(400).send({
          error: {
            message: 'Invalid intent ID',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            details: parseResult.error.flatten().fieldErrors,
          },
        });
      }

      const { id } = parseResult.data;

      const intent = await intentService.getIntentById(id);

      if (!intent) {
        request.log.warn({ intentId: id }, 'Intent not found');
        return reply.status(404).send({
          error: {
            message: 'Intent not found',
            code: 'NOT_FOUND',
            statusCode: 404,
          },
        });
      }

      request.log.info(
        { intentId: intent.id, state: intent.state },
        'Intent retrieved'
      );

      return reply.status(200).send(intent);
    }
  );

  app.get<{ Params: IntentIdParams }>(
    '/intents/:id/quotes',
    async (request: FastifyRequest<{ Params: IntentIdParams }>, reply: FastifyReply) => {
      request.log.info({ intentId: request.params.id }, 'GET /intents/:id/quotes received');

      const parseResult = intentIdParamSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            message: 'Invalid intent ID',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
          },
        });
      }

      const { id } = parseResult.data;

      const intent = await intentService.getIntentById(id);
      if (!intent) {
        return reply.status(404).send({
          error: {
            message: 'Intent not found',
            code: 'NOT_FOUND',
            statusCode: 404,
          },
        });
      }

      const quotes = await findQuotesByIntentId(id);

      request.log.info(
        { intentId: id, quotesCount: quotes.length },
        'Quotes retrieved'
      );

      return reply.status(200).send({ quotes });
    }
  );

  app.post<{ Params: IntentIdParams; Body: { quoteId: string } }>(
    '/intents/:id/accept',
    async (
      request: FastifyRequest<{ Params: IntentIdParams; Body: { quoteId: string } }>,
      reply: FastifyReply
    ) => {
      request.log.info(
        { intentId: request.params.id, body: request.body },
        'POST /intents/:id/accept received'
      );

      const paramResult = intentIdParamSchema.safeParse(request.params);
      if (!paramResult.success) {
        return reply.status(400).send({
          error: {
            message: 'Invalid intent ID',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
          },
        });
      }

      const bodySchema = z.object({
        quoteId: z.string().uuid('quoteId must be a valid UUID'),
      });

      const bodyResult = bodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            message: 'Invalid request body',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            details: bodyResult.error.flatten().fieldErrors,
          },
        });
      }

      const { id: intentId } = paramResult.data;
      const { quoteId } = bodyResult.data;

      try {
        const result = await intentService.acceptIntent(intentId, quoteId);

        request.log.info(
          { intentId, quoteId, state: result.state },
          'Intent accepted successfully'
        );

        return reply.status(200).send({
          intentId: result.intentId,
          state: result.state,
          executionId: result.executionId,
        });
      } catch (error) {
        request.log.error({ error, intentId, quoteId }, 'Failed to accept intent');

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (errorMessage.includes('not found')) {
          return reply.status(404).send({
            error: {
              message: errorMessage,
              code: 'NOT_FOUND',
              statusCode: 404,
            },
          });
        }

        if (errorMessage.includes('Invalid state')) {
          return reply.status(400).send({
            error: {
              message: errorMessage,
              code: 'INVALID_STATE',
              statusCode: 400,
            },
          });
        }

        throw error;
      }
    }
  );
}
