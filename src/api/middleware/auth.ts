import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/config/index.js';

export interface JWTPayload {
   userId: string;
   telegramId: string;
}

declare module 'fastify' {
   interface FastifyRequest {
      userId?: string;
      telegramId?: string;
   }
}

export async function authMiddleware(
   request: FastifyRequest,
   reply: FastifyReply
): Promise<void> {
   const authHeader = request.headers.authorization;

   if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
         error: 'Unauthorized',
         message:
            'Missing or invalid Authorization header. Expected: Bearer <token>',
      });
   }

   const token = authHeader.replace('Bearer ', '');

   try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload;

      // Attach userId and telegramId to request for use in route handlers
      request.userId = decoded.userId;
      request.telegramId = decoded.telegramId;
   } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
         return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Token has expired',
         });
      }

      if (err instanceof jwt.JsonWebTokenError) {
         return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid token',
         });
      }

      return reply.code(401).send({
         error: 'Unauthorized',
         message: 'Token verification failed',
      });
   }
}

/**
 * Generate JWT token for a user
 */
export function generateToken(payload: JWTPayload): string {
   return jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
   } as jwt.SignOptions) as string;
}

export function verifyToken(token: string): JWTPayload | null {
   try {
      return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
   } catch {
      return null;
   }
}
