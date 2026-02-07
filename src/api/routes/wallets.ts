import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import type { WalletService } from '../../domain/wallet/wallet-service.js';
import { getViemClient } from '../../adapters/blockchain/viem-client.js';
import {
   getRpcUrlForChain,
   isChainSupported,
   getChainName,
} from '../../shared/utils/chain-rpc.js';

const walletQuerySchema = z.object({
   chainId: z.coerce.number().optional().default(1),
});

export async function walletRoutes(
   fastify: FastifyInstance,
   opts: { walletService: WalletService }
): Promise<void> {
   const { walletService } = opts;

   fastify.get(
      '/wallets',
      {
         onRequest: [authMiddleware],
      },
      async (request, reply) => {
         const { userId } = request;

         if (!userId) {
            return reply.code(401).send({
               error: 'Unauthorized',
               message: 'User ID not found in token',
            });
         }

         // Parse and validate chainId from query
         const query = walletQuerySchema.parse(request.query);
         const chainId = query.chainId;

         // Validate chain is supported
         const supported = await isChainSupported(chainId);
         if (!supported) {
            return reply.code(400).send({
               error: 'Bad Request',
               message: `Unsupported chain ID: ${chainId}. Supported: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum)`,
            });
         }

         const chainName = await getChainName(chainId);
         fastify.log.info(
            { userId, chainId, chainName },
            'Getting wallet for user'
         );

         try {
            const wallet = await walletService.getWalletByUserId(userId);

            if (!wallet) {
               return reply.code(404).send({
                  error: 'Not Found',
                  message: 'Wallet not found for user',
               });
            }

            // Fetch balance for specified chain
            let ethBalance = '0';
            try {
               const rpcUrl = getRpcUrlForChain(chainId);
               const client = getViemClient(chainId, rpcUrl);
               const balance = await client.getBalance({
                  address: wallet.address as `0x${string}`,
               });
               ethBalance = balance.toString();
            } catch (error) {
               fastify.log.warn(
                  { error, address: wallet.address, chainId },
                  'Failed to fetch balance'
               );
               // Continue without balance if RPC fails
            }

            return reply.code(200).send({
               id: wallet.id,
               address: wallet.address,
               chainId: chainId,
               chainName: chainName,
               balances: {
                  eth: ethBalance,
               },
            });
         } catch (error) {
            fastify.log.error({ error, userId }, 'Failed to get wallet');

            return reply.code(500).send({
               error: 'Internal Server Error',
               message: 'Failed to retrieve wallet',
            });
         }
      }
   );

   fastify.get(
      '/wallets/:id',
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

         // Parse and validate chainId from query
         const query = walletQuerySchema.parse(request.query);
         const chainId = query.chainId;

         // Validate chain is supported
         const supported = await isChainSupported(chainId);
         if (!supported) {
            return reply.code(400).send({
               error: 'Bad Request',
               message: `Unsupported chain ID: ${chainId}. Supported: 1 (Ethereum), 8453 (Base), 42161 (Arbitrum)`,
            });
         }

         const chainName = await getChainName(chainId);
         fastify.log.info(
            { userId, walletId: id, chainId, chainName },
            'Getting wallet by ID'
         );

         try {
            const wallet = await walletService.getWalletById(id);

            if (!wallet) {
               return reply.code(404).send({
                  error: 'Not Found',
                  message: 'Wallet not found',
               });
            }

            // Verify wallet belongs to user
            if (wallet.userId !== userId) {
               return reply.code(403).send({
                  error: 'Forbidden',
                  message: 'You do not have access to this wallet',
               });
            }

            // Fetch balance for specified chain
            let ethBalance = '0';
            try {
               const rpcUrl = getRpcUrlForChain(chainId);
               const client = getViemClient(chainId, rpcUrl);
               const balance = await client.getBalance({
                  address: wallet.address as `0x${string}`,
               });
               ethBalance = balance.toString();
            } catch (error) {
               fastify.log.warn(
                  { error, address: wallet.address, chainId },
                  'Failed to fetch balance'
               );
            }

            return reply.code(200).send({
               id: wallet.id,
               address: wallet.address,
               chainId: chainId,
               chainName: chainName,
               balances: {
                  eth: ethBalance,
               },
            });
         } catch (error) {
            fastify.log.error({ error, walletId: id }, 'Failed to get wallet');

            return reply.code(500).send({
               error: 'Internal Server Error',
               message: 'Failed to retrieve wallet',
            });
         }
      }
   );

   fastify.log.info('Wallet routes registered');
}
