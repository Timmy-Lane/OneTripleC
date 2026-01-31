import { Telegraf } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import type { AuthService } from '../domain/auth/auth-service.js';
import type { WalletService } from '../domain/wallet/wallet-service.js';
import { getViemClient } from '../adapters/blockchain/viem-client.js';
import { config } from '../shared/config/index.js';
import { formatEther, type Address } from 'viem';

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

   private async getEthBalance(address: Address): Promise<string> {
      try {
         const client = getViemClient(1, config.ETHEREUM_RPC_URL);
         const balance = await client.getBalance({ address });
         return formatEther(balance);
      } catch (error) {
         console.error('Error fetching ETH balance:', error);
         return '0.00';
      }
   }

   private async showMainMenu(
      ctx: any,
      userId: string,
      editMessage = false
   ): Promise<void> {
      const wallet = await this.walletService.getWalletByUserId(userId);
      if (!wallet) {
         await ctx.reply('Error: Wallet not found');
         return;
      }

      const ethBalance = await this.getEthBalance(wallet.address as Address);

      const message = `🏠 OneTripleC

<b>Wallet:</b>
<code>${wallet.address}</code>

<b>Balance:</b>
ETH - ${ethBalance}
USDC - 0.00
USDT - 0.00`;

      const keyboard = {
         parse_mode: 'HTML' as const,
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
      };

      if (editMessage && ctx.callbackQuery?.message) {
         await ctx.editMessageText(message, keyboard);
      } else {
         await ctx.reply(message, keyboard);
      }
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

<b>Address:</b>
<code>${wallet.address}</code>

<b>Private Key:</b>
<code>${privateKey}</code>

<b>IMPORTANT:</b> Save your private key securely. This is the only time it will be shown.`;

               await ctx.reply(message, {
                  parse_mode: 'HTML',
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
         try {
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
         } catch (error) {
            console.error('Error in start handler:', error);
         }
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
         try {
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

            await this.showMainMenu(ctx, user.id, true);
         } catch (error) {
            console.error('Error in refresh_balance handler:', error);
         }
      });

      this.bot.action('wallet', async ctx => {
         try {
            // Answer callback query FIRST to prevent timeout
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

            const wallet = await this.walletService.getWalletByUserId(user.id);
            if (!wallet) {
               await ctx.reply('Error: Wallet not found');
               return;
            }

            const message = `👛 Wallet

<b>Wallet List:</b>
Active Wallet

<b>Address:</b>
<code>${wallet.address}</code>

<b>Network:</b>
Ethereum`;

            const keyboard = {
               parse_mode: 'HTML' as const,
               reply_markup: {
                  inline_keyboard: [
                     [{ text: 'Add Wallet', callback_data: 'add_wallet' }],
                     [
                        {
                           text: 'Show Private Key',
                           callback_data: 'show_private_key',
                        },
                     ],
                     [
                        {
                           text: 'Change Active Wallet',
                           callback_data: 'change_active_wallet',
                        },
                     ],
                     [
                        {
                           text: 'Delete Wallet',
                           callback_data: 'delete_wallet',
                        },
                     ],
                     [
                        {
                           text: 'Change Network',
                           callback_data: 'change_network',
                        },
                     ],
                     [{ text: 'Back', callback_data: 'back_to_main' }],
                  ],
               },
            };

            if (ctx.callbackQuery?.message) {
               await ctx.editMessageText(message, keyboard);
            } else {
               await ctx.reply(message, keyboard);
            }
         } catch (error) {
            console.error('Error in wallet handler:', error);
         }
      });

      // Handle wallet action button handlers
      this.bot.action('add_wallet', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Add wallet functionality coming soon!');
      });

      this.bot.action('show_private_key', async ctx => {
         try {
            // Answer callback query FIRST to prevent timeout
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

            const wallet = await this.walletService.getWalletByUserId(user.id);
            if (!wallet) {
               await ctx.reply('Error: Wallet not found');
               return;
            }

            const privateKey = await this.walletService.getPrivateKey(
               wallet.id
            );

            await ctx.reply(
               `⚠️ SECURITY WARNING ⚠️

Your Private Key:
<code>${privateKey}</code>

NEVER share this with anyone!
Anyone with this key has full access to your wallet.`,
               { parse_mode: 'HTML' }
            );
         } catch (error) {
            console.error('Error in show_private_key handler:', error);
         }
      });

      this.bot.action('change_active_wallet', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Change active wallet functionality coming soon!');
      });

      this.bot.action('delete_wallet', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Delete wallet functionality coming soon!');
      });

      this.bot.action('change_network', async ctx => {
         await ctx.answerCbQuery();
         await ctx.reply('Change network functionality coming soon!');
      });

      this.bot.action('back_to_main', async ctx => {
         try {
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

            await this.showMainMenu(ctx, user.id, true);
         } catch (error) {
            console.error('Error in back_to_main handler:', error);
         }
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
