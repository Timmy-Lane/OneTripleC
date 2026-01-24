import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { intentService, setIntentServiceLogger } from '../../domain/intents/intent-service.js';
import { setQueueLogger } from '../../services/queue.js';

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
}
