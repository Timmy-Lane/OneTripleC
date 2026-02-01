import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { findExecutionById } from '../../persistence/repositories/execution-repository.js';
import { findQuoteById } from '../../persistence/repositories/quote-repository.js';
import type { QuoteRoute } from '../../shared/types/quote.js';

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

   fastify.get(
      '/executions/:id/transactions',
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
            'Getting execution transactions'
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

            // Fetch the quote to get route information
            const quote = await findQuoteById(execution.quoteId);

            if (!quote) {
               return reply.code(404).send({
                  error: 'Not Found',
                  message: 'Quote not found for execution',
               });
            }

            const route = quote.route as unknown as QuoteRoute;

            const transactions = [];

            // Add submitted transaction if exists
            if (execution.txHash) {
               transactions.push({
                  txHash: execution.txHash,
                  chainId: execution.chainId,
                  state: execution.state,
                  submittedAt: execution.submittedAt?.toISOString() || null,
                  confirmedAt: execution.confirmedAt?.toISOString() || null,
                  explorerUrl: getExplorerUrl(
                     execution.chainId,
                     execution.txHash
                  ),
               });
            }

            // Return route steps for context (future: these will be separate transactions)
            const routeSteps = route.steps.map((step, index) => ({
               stepIndex: index,
               type: step.type,
               chainId: step.chainId,
               protocol: step.protocol,
               fromToken: step.fromToken,
               toToken: step.toToken,
               fromAmount: step.fromAmount,
               toAmountMin: step.toAmountMin,
            }));

            return reply.code(200).send({
               executionId: execution.id,
               transactions,
               routeSteps,
               totalSteps: route.steps.length,
            });
         } catch (error) {
            fastify.log.error(
               { error, executionId: id },
               'Failed to get execution transactions'
            );

            return reply.code(500).send({
               error: 'Internal Server Error',
               message: 'Failed to retrieve execution transactions',
            });
         }
      }
   );

   fastify.log.info('Execution routes registered');
}

function getExplorerUrl(chainId: number, txHash: string): string {
   const explorers: Record<number, string> = {
      1: 'https://etherscan.io/tx',
      8453: 'https://basescan.org/tx',
      42161: 'https://arbiscan.io/tx',
      10: 'https://optimistic.etherscan.io/tx',
      137: 'https://polygonscan.com/tx',
   };

   const baseUrl = explorers[chainId] || 'https://etherscan.io/tx';
   return `${baseUrl}/${txHash}`;
} // remove in future!
