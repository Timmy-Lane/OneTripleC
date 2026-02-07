import { Telegraf } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import type { AuthService } from '../domain/auth/auth-service.js';
import type { WalletService } from '../domain/wallet/wallet-service.js';
import { getViemClient } from '../adapters/blockchain/viem-client.js';
import { config } from '../shared/config/index.js';
import { formatEther, parseUnits, type Address } from 'viem';
import { intentService } from '../domain/intents/intent-service.js';
import { findQuotesByIntentId } from '../persistence/repositories/quote-repository.js';
import { findExecutionById } from '../persistence/repositories/execution-repository.js';
import { getExplorerUrl } from '../shared/utils/chain-rpc.js';

// Swap conversation state
interface SwapState {
   step: 'chain' | 'sourceToken' | 'amount' | 'targetToken' | 'confirm' | 'pending' | 'done';
   chainId?: number;
   sourceToken?: string;
   targetToken?: string;
   amount?: string;
   intentId?: string;
   userId?: string;
}

// Store conversation state per user
const swapStates = new Map<number, SwapState>();

// Supported chains for V1
const SUPPORTED_CHAINS = [
   { id: 1, name: 'Ethereum', symbol: 'ETH' },
   { id: 8453, name: 'Base', symbol: 'ETH' },
   { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
];

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

   private async showQuotes(ctx: any, telegramId: number, intentId: string): Promise<void> {
      try {
         const quotes = await findQuotesByIntentId(intentId);

         if (quotes.length === 0) {
            await ctx.editMessageText(
               '❌ No quotes available for this swap.',
               {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '🔄 Try Again', callback_data: 'swap' }],
                        [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
            swapStates.delete(telegramId);
            return;
         }

         // Build quote display
         let message = '📊 <b>Available Quotes</b>\n\n';
         const buttons: { text: string; callback_data: string }[][] = [];

         for (let i = 0; i < quotes.length; i++) {
            const quote = quotes[i];
            const route = quote.route as any;
            const provider = route?.provider || 'Unknown';
            const output = quote.estimatedOutput || '0';
            const fee = quote.totalFee || '0';

            message += `<b>${i + 1}. ${provider}</b>\n`;
            message += `Output: ${output} wei\n`;
            message += `Fee: ${fee} wei\n\n`;

            buttons.push([
               { text: `Select ${provider}`, callback_data: `swap_accept_${quote.id}` },
            ]);
         }

         buttons.push([{ text: '❌ Cancel', callback_data: 'back_to_main' }]);

         await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: {
               inline_keyboard: buttons,
            },
         });
      } catch (error) {
         console.error('Error showing quotes:', error);
         await ctx.editMessageText('Error loading quotes. Please try again.');
      }
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
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) {
               await ctx.reply('Error: Could not identify user');
               return;
            }

            // Get user
            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            // Initialize swap state
            swapStates.set(telegramId, {
               step: 'chain',
               userId: user.id,
            });

            // Show chain selection
            await ctx.editMessageText(
               `🔄 <b>Swap Tokens</b>

Select the network for your swap:`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...SUPPORTED_CHAINS.map(chain => [
                           { text: `${chain.name}`, callback_data: `swap_chain_${chain.id}` },
                        ]),
                        [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in swap handler:', error);
            await ctx.reply('An error occurred. Please try again.');
         }
      });

      // Handle chain selection
      this.bot.action(/^swap_chain_(\d+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const chainId = parseInt(ctx.match[1]);
            const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
            if (!chain) {
               await ctx.reply('Invalid chain selected');
               return;
            }

            const state = swapStates.get(telegramId);
            if (!state) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            state.chainId = chainId;
            state.step = 'sourceToken';
            swapStates.set(telegramId, state);

            await ctx.editMessageText(
               `🔄 <b>Swap on ${chain.name}</b>

Enter the <b>source token</b> address (the token you want to sell):

Example: <code>0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48</code> (USDC)

Or use ETH address: <code>0x0000000000000000000000000000000000000000</code>`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in chain selection:', error);
         }
      });

      // Handle text input for swap flow
      this.bot.on('text', async ctx => {
         try {
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state) return; // No active swap flow

            const text = ctx.message.text.trim();

            if (state.step === 'sourceToken') {
               // Validate token address
               if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
                  await ctx.reply('Invalid token address. Please enter a valid Ethereum address starting with 0x');
                  return;
               }

               state.sourceToken = text;
               state.step = 'amount';
               swapStates.set(telegramId, state);

               await ctx.reply(
                  `✅ Source token set

Now enter the <b>amount</b> to swap:

Example: <code>1.5</code> (in token units, not wei)`,
                  {
                     parse_mode: 'HTML',
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
            } else if (state.step === 'amount') {
               // Validate amount
               const amount = parseFloat(text);
               if (isNaN(amount) || amount <= 0) {
                  await ctx.reply('Invalid amount. Please enter a positive number.');
                  return;
               }

               // Store amount in wei (18 decimals by default)
               state.amount = parseUnits(text, 18).toString();
               state.step = 'targetToken';
               swapStates.set(telegramId, state);

               await ctx.reply(
                  `✅ Amount set: ${text}

Now enter the <b>target token</b> address (the token you want to buy):

Example: <code>0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2</code> (WETH)`,
                  {
                     parse_mode: 'HTML',
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
            } else if (state.step === 'targetToken') {
               // Validate token address
               if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
                  await ctx.reply('Invalid token address. Please enter a valid Ethereum address starting with 0x');
                  return;
               }

               state.targetToken = text;
               state.step = 'confirm';
               swapStates.set(telegramId, state);

               const chain = SUPPORTED_CHAINS.find(c => c.id === state.chainId);

               await ctx.reply(
                  `📋 <b>Swap Summary</b>

<b>Network:</b> ${chain?.name || 'Unknown'}
<b>From:</b> <code>${state.sourceToken}</code>
<b>Amount:</b> ${state.amount} wei
<b>To:</b> <code>${state.targetToken}</code>

Ready to get quotes?`,
                  {
                     parse_mode: 'HTML',
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '✅ Get Quotes', callback_data: 'swap_get_quotes' }],
                           [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
            }
         } catch (error) {
            console.error('Error handling text input:', error);
         }
      });

      // Handle get quotes action
      this.bot.action('swap_get_quotes', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state || state.step !== 'confirm') {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            if (!state.userId || !state.chainId || !state.sourceToken || !state.targetToken || !state.amount) {
               await ctx.reply('Missing swap data. Please start again.');
               return;
            }

            await ctx.editMessageText('🔄 Creating intent and fetching quotes...');

            // Create intent with structured JSON
            const rawMessage = JSON.stringify({
               action: 'swap',
               chainId: state.chainId,
               sourceToken: state.sourceToken,
               targetToken: state.targetToken,
               amount: state.amount,
            });

            const intent = await intentService.createIntent({
               userId: state.userId,
               rawMessage,
            });

            state.intentId = intent.id;
            state.step = 'pending';
            swapStates.set(telegramId, state);

            // Poll for quotes
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds max
            const pollInterval = setInterval(async () => {
               attempts++;
               try {
                  const currentIntent = await intentService.getIntentById(intent.id);

                  if (currentIntent?.state === 'QUOTED') {
                     clearInterval(pollInterval);
                     await this.showQuotes(ctx, telegramId, intent.id);
                  } else if (currentIntent?.state === 'FAILED') {
                     clearInterval(pollInterval);
                     await ctx.editMessageText(
                        `❌ Failed to get quotes: ${currentIntent.errorMessage || 'Unknown error'}`,
                        {
                           reply_markup: {
                              inline_keyboard: [
                                 [{ text: '🔄 Try Again', callback_data: 'swap' }],
                                 [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                              ],
                           },
                        }
                     );
                     swapStates.delete(telegramId);
                  } else if (attempts >= maxAttempts) {
                     clearInterval(pollInterval);
                     await ctx.editMessageText(
                        '⏱️ Timeout waiting for quotes. Please try again.',
                        {
                           reply_markup: {
                              inline_keyboard: [
                                 [{ text: '🔄 Try Again', callback_data: 'swap' }],
                                 [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                              ],
                           },
                        }
                     );
                     swapStates.delete(telegramId);
                  }
               } catch (err) {
                  console.error('Error polling for quotes:', err);
               }
            }, 1000);
         } catch (error) {
            console.error('Error getting quotes:', error);
            await ctx.reply('An error occurred. Please try again.');
         }
      });

      // Handle quote selection
      this.bot.action(/^swap_accept_(\S+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const quoteId = ctx.match[1];
            const state = swapStates.get(telegramId);

            if (!state || !state.intentId) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            await ctx.editMessageText('🔄 Executing swap...');

            try {
               const result = await intentService.acceptIntent(state.intentId, quoteId);

               // Poll for execution status
               let attempts = 0;
               const maxAttempts = 60; // 60 seconds max
               const pollInterval = setInterval(async () => {
                  attempts++;
                  try {
                     const execution = await findExecutionById(result.executionId);

                     if (execution?.state === 'CONFIRMED') {
                        clearInterval(pollInterval);
                        const explorerUrl = await getExplorerUrl(state.chainId!);
                        const txLink = explorerUrl ? `${explorerUrl}/tx/${execution.txHash}` : '';

                        await ctx.editMessageText(
                           `✅ <b>Swap Complete!</b>

Transaction hash:
<code>${execution.txHash}</code>

${txLink ? `<a href="${txLink}">View on Explorer</a>` : ''}`,
                           {
                              parse_mode: 'HTML',
                              reply_markup: {
                                 inline_keyboard: [
                                    [{ text: '🔄 New Swap', callback_data: 'swap' }],
                                    [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                                 ],
                              },
                           }
                        );
                        swapStates.delete(telegramId);
                     } else if (execution?.state === 'FAILED') {
                        clearInterval(pollInterval);
                        await ctx.editMessageText(
                           `❌ <b>Swap Failed</b>

Error: ${execution.errorMessage || 'Unknown error'}`,
                           {
                              parse_mode: 'HTML',
                              reply_markup: {
                                 inline_keyboard: [
                                    [{ text: '🔄 Try Again', callback_data: 'swap' }],
                                    [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                                 ],
                              },
                           }
                        );
                        swapStates.delete(telegramId);
                     } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        await ctx.editMessageText(
                           `⏱️ Transaction submitted but confirmation timeout.

Transaction hash: <code>${execution?.txHash || 'Unknown'}</code>

Check your wallet for status.`,
                           {
                              parse_mode: 'HTML',
                              reply_markup: {
                                 inline_keyboard: [
                                    [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                                 ],
                              },
                           }
                        );
                        swapStates.delete(telegramId);
                     }
                  } catch (err) {
                     console.error('Error polling execution:', err);
                  }
               }, 1000);
            } catch (error: any) {
               await ctx.editMessageText(
                  `❌ Failed to execute swap: ${error.message || 'Unknown error'}`,
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '🔄 Try Again', callback_data: 'swap' }],
                           [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
               swapStates.delete(telegramId);
            }
         } catch (error) {
            console.error('Error accepting quote:', error);
         }
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
