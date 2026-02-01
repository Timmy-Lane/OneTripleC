import type { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { DomainError } from '../../shared/errors/domain-errors.js';

export async function errorHandler(
   error: FastifyError,
   request: FastifyRequest,
   reply: FastifyReply
): Promise<void> {
   // Log error with structured context
   request.log.error(
      {
         error: {
            name: error.name,
            message: error.message,
            code: (error as any).code,
            stack: error.stack,
         },
         request: {
            method: request.method,
            url: request.url,
            userId: request.userId,
         },
      },
      'Request error'
   );

   // Handle domain errors with mapped status codes
   if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
         error: error.name,
         message: error.message,
         code: error.code,
         details: error.details,
      });
   }

   // Handle Fastify validation errors
   if (error.validation) {
      return reply.code(400).send({
         error: 'ValidationError',
         message: 'Request validation failed',
         code: 'VALIDATION_ERROR',
         details: {
            validation: error.validation,
         },
      });
   }

   // Handle generic Fastify errors
   if (error.statusCode) {
      return reply.code(error.statusCode).send({
         error: error.name || 'Error',
         message: error.message,
         code: (error as any).code || 'UNKNOWN_ERROR',
      });
   }

   return reply.code(500).send({
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
      code: 'INTERNAL_SERVER_ERROR',
   });
}
