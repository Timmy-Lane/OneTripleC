import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { findExecutionById } from '../../persistence/repositories/execution-repository.js';

export async function executionRoutes(fastify: FastifyInstance): Promise<void> {
   fastify.get(
      '/executions/:id',
      {
         onRequest: [authMiddleware],
      },
      async (request, reply) => {
         const { userId } = request;
         const { id } = request.params as { id: string };

         if (!userId) {
            return reply.code(401).send({
               error: 'Unauthorized',
               message: 'User ID not found in token',
            });
         }

         fastify.log.info(
            { userId, executionId: id },
            'Getting execution status'
         );

         try {
            const execution = await findExecutionById(id);

            if (!execution) {
               return reply.code(404).send({
                  error: 'Not Found',
                  message: 'Execution not found',
               });
            }

            // Verify execution belongs to user
            if (execution.userId !== userId) {
               return reply.code(403).send({
                  error: 'Forbidden',
                  message: 'You do not have access to this execution',
               });
            }

            return reply.code(200).send({
               id: execution.id,
               intentId: execution.intentId,
               quoteId: execution.quoteId,
               state: execution.state,
               txHash: execution.txHash,
               chainId: execution.chainId,
               errorMessage: execution.errorMessage,
               createdAt: execution.createdAt.toISOString(),
               submittedAt: execution.submittedAt?.toISOString() || null,
               confirmedAt: execution.confirmedAt?.toISOString() || null,
            });
         } catch (error) {
            fastify.log.error(
               { error, executionId: id },
               'Failed to get execution'
            );

            return reply.code(500).send({
               error: 'Internal Server Error',
               message: 'Failed to retrieve execution',
            });
         }
      }
   );

   fastify.log.info('Execution routes registered');
}
