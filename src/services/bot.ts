import { Telegraf } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import type { AuthService } from '../domain/auth/auth-service.js';
import type { WalletService } from '../domain/wallet/wallet-service.js';

export class BotService {
   private client: TelegramClient;
   private bot: Telegraf;
   private authService: AuthService;
   private walletService: WalletService;

   constructor(
      token: string,
      authService: AuthService,
      walletService: WalletService
   ) {
      this.client = new TelegramClient(token);
      this.bot = this.client.getBot();
      this.authService = authService;
      this.walletService = walletService;
      this.setupHandlers();
   }

   private async showMainMenu(ctx: any, userId: string): Promise<void> {
      const wallet = await this.walletService.getWalletByUserId(userId);
      if (!wallet) {
         await ctx.reply('Error: Wallet not found');
         return;
      }

      // Truncate wallet address for display
      const truncatedAddress = `${wallet.address.slice(
         0,
         6
      )}...${wallet.address.slice(-4)}`;

      // TODO: Fetch real balances from blockchain
      // For now, showing placeholder values
      const message = `🏠 OneTripleC

Wallet:
${truncatedAddress}

Balance:
ETH: 0.00
USDC: 0.00`;

      await ctx.reply(message, {
         reply_markup: {
            inline_keyboard: [
               [
                  { text: 'Swap', callback_data: 'swap' },
                  { text: 'Bridge', callback_data: 'bridge' },
               ],
               [{ text: 'Cross-Chain', callback_data: 'cross_chain' }],
               [
                  {
                     text: '💰 Refresh Balance',
                     callback_data: 'refresh_balance',
                  },
               ],
               [{ text: '⚙️ Wallet', callback_data: 'wallet' }],
            ],
         },
      });
   }

   private setupHandlers(): void {
      this.bot.start(async ctx => {
         try {
            const telegramId = ctx.from?.id;
            if (!telegramId) {
               await ctx.reply('Error: Could not identify user');
               return;
            }

            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from.username,
                  first_name: ctx.from.first_name,
               },
            });

            if (user.isNewUser) {
               const wallet = await this.walletService.getWalletByUserId(
                  user.id
               );
               if (!wallet) {
                  await ctx.reply('Error: Wallet not found');
                  return;
               }

               const privateKey = await this.walletService.getPrivateKey(
                  wallet.id
               );

               const message = `Welcome to OneTripleC

I help you swap tokens across chains with ONE confirmation.

Your wallet has been created.
Address:
\`${wallet.address}\`

Private Key:
\`${privateKey}\`

IMPORTANT: Save your private key securely. This is the only time it will be shown.`;

               await ctx.reply(message, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '▶ Start', callback_data: 'start' }],
                        [{ text: 'Settings', callback_data: 'settings' }],
                        [{ text: 'Help', callback_data: 'help' }],
                     ],
                  },
               });
            } else {
               // Existing user - go directly to main menu
               await this.showMainMenu(ctx, user.id);
            }
         } catch (error) {
            console.error('Error in /start handler:', error);
            await ctx.reply('An error occurred. Please try again.');
         }
      });

      // Handle Start button - show main menu
      this.bot.action('start', async ctx => {
         await ctx.answerCbQuery();
         const telegramId = ctx.from?.id;
         if (!telegramId) {
            await ctx.reply('Error: Could not identify user');
            return;
         }

         const user = await this.authService.getOrCreateUser({
            provider: 'telegram',
            providerId: telegramId.toString(),
            metadata: {
               username: ctx.from?.username,
               first_name: ctx.from?.first_name,
            },
         });

         await this.showMainMenu(ctx, user.id);
      });

      // Handle Settings button
      this.bot.action('settings', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Settings functionality coming soon!');
      });

      // Handle Help button
      this.bot.action('help', async ctx => {
         await ctx.answerCbQuery();
         const helpMessage = `How to use OneTripleC:

1. Use the menu buttons to initiate swaps, bridges, or cross-chain transactions

2. I'll find the best route and show you options

3. Confirm the transaction

4. Done! I'll notify you when complete.`;
         await ctx.reply(helpMessage);
      });

      // Main menu button handlers
      this.bot.action('swap', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Swap functionality coming soon!');
      });

      this.bot.action('bridge', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Bridge functionality coming soon!');
      });

      this.bot.action('cross_chain', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Cross-chain functionality coming soon!');
      });

      this.bot.action('refresh_balance', async ctx => {
         await ctx.answerCbQuery();
         const telegramId = ctx.from?.id;
         if (!telegramId) {
            await ctx.reply('Error: Could not identify user');
            return;
         }

         const user = await this.authService.getOrCreateUser({
            provider: 'telegram',
            providerId: telegramId.toString(),
            metadata: {
               username: ctx.from?.username,
               first_name: ctx.from?.first_name,
            },
         });

         await this.showMainMenu(ctx, user.id);
      });

      this.bot.action('wallet', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Wallet settings coming soon!');
      });
   }

   async start(): Promise<void> {
      await this.bot.launch();
      console.log('Telegram bot started');
   }

   async stop(): Promise<void> {
      this.bot.stop();
   }
}

export async function createBotService(
   token: string,
   authService: AuthService,
   walletService: WalletService
): Promise<BotService> {
   const service = new BotService(token, authService, walletService);
   await service.start();
   return service;
}
