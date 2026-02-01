import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import type { AuthService } from '../../domain/auth/auth-service.js';

const telegramAuthSchema = z.object({
   telegramId: z.string(),
   username: z.string().optional(),
   firstName: z.string().optional(),
   lastName: z.string().optional(),
});

export async function authRoutes(
   fastify: FastifyInstance,
   opts: { authService: AuthService }
): Promise<void> {
   const { authService } = opts;

   fastify.post('/auth/telegram', async (request, reply) => {
      const body = telegramAuthSchema.parse(request.body);

      fastify.log.info(
         { telegramId: body.telegramId },
         'Authenticating Telegram user'
      );

      try {
         // Get or create user via auth service
         const user = await authService.getOrCreateUser({
            provider: 'telegram',
            providerId: body.telegramId,
            metadata: {
               username: body.username,
               first_name: body.firstName,
               last_name: body.lastName,
            },
         });

         const token = generateToken({
            userId: user.id,
            telegramId: body.telegramId,
         });

         fastify.log.info(
            { userId: user.id, isNewUser: user.isNewUser },
            'User authenticated successfully'
         );

         return reply.code(200).send({
            token,
            user: {
               id: user.id,
               walletAddress: user.walletAddress,
               isNewUser: user.isNewUser,
            },
         });
      } catch (error) {
         fastify.log.error(
            { error, telegramId: body.telegramId },
            'Failed to authenticate user'
         );

         return reply.code(500).send({
            error: 'Internal Server Error',
            message: 'Failed to authenticate user',
         });
      }
   });

   fastify.post(
      '/auth/refresh',
      {
         onRequest: [authMiddleware],
      },
      async (request, reply) => {
         // userId and telegramId are attached by authMiddleware
         const { userId, telegramId } = request;

         if (!userId || !telegramId) {
            return reply.code(401).send({
               error: 'Unauthorized',
               message: 'Invalid token payload',
            });
         }

         fastify.log.info({ userId }, 'Refreshing JWT token');

         const newToken = generateToken({
            userId,
            telegramId,
         });

         return reply.code(200).send({
            token: newToken,
         });
      }
   );

   fastify.get(
      '/auth/me',
      {
         onRequest: [authMiddleware],
      },
      async (request, reply) => {
         // userId and telegramId are attached by authMiddleware
         const { userId, telegramId } = request;

         if (!userId || !telegramId) {
            return reply.code(401).send({
               error: 'Unauthorized',
               message: 'Invalid token payload',
            });
         }

         return reply.code(200).send({
            userId,
            telegramId,
         });
      }
   );

   fastify.log.info('Auth routes registered');
}
