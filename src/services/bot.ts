import { Telegraf } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import type { AuthService } from '../domain/auth/auth-service.js';
import type { WalletService } from '../domain/wallet/wallet-service.js';
import { getViemClient } from '../adapters/blockchain/viem-client.js';
import { formatEther, parseUnits, type Address } from 'viem';
import { intentService } from '../domain/intents/intent-service.js';
import { findQuotesByIntentId } from '../persistence/repositories/quote-repository.js';
import { findExecutionById } from '../persistence/repositories/execution-repository.js';
import { getExplorerUrl, getRpcUrlForChain, hasRpcConfigured } from '../shared/utils/chain-rpc.js';
import { getTokenInfo } from '../adapters/tokens/token-info.js';
import { formatTokenAmount, formatProviderName, formatFeeDisplay } from '../shared/utils/format.js';
import { findActiveChains, findChainById } from '../persistence/repositories/chain-repository.js';
import { findTokensByChainId } from '../persistence/repositories/token-repository.js';
import { quoteService } from '../domain/routing/quote-service.js';
import { getSpokePoolAddress } from '../adapters/bridge/across-adapter.js';

// Swap conversation state
interface SwapState {
   step:
      | 'chain'
      | 'sourceToken'
      | 'amount'
      | 'targetToken'
      | 'confirm'
      | 'pending'
      | 'done';
   chainId?: number;
   sourceToken?: string;
   targetToken?: string;
   amount?: string; // wei amount
   displayAmount?: string; // human-readable amount entered by user
   intentId?: string;
   userId?: string;
   // auto-refresh state
   refreshInterval?: ReturnType<typeof setInterval>;
   refreshStartedAt?: number;
}

// Store conversation state per user
const swapStates = new Map<number, SwapState>();

// Bridge conversation state
interface BridgeState {
   step: 'sourceChain' | 'targetChain' | 'token' | 'amount' | 'pending' | 'done';
   sourceChainId?: number;
   targetChainId?: number;
   token?: string;
   amount?: string;
   displayAmount?: string;
   intentId?: string;
   userId?: string;
   refreshInterval?: ReturnType<typeof setInterval>;
   refreshStartedAt?: number;
}

const bridgeStates = new Map<number, BridgeState>();

// chains with Across spoke pool support
const ACROSS_CHAIN_IDS = new Set([1, 137, 42161, 10, 8453]);

const REFRESH_INTERVAL_MS = 5_000;
const REFRESH_TIMEOUT_MS = 60_000;

function stopRefresh(telegramId: number): void {
   const state = swapStates.get(telegramId);
   if (state?.refreshInterval) {
      clearInterval(state.refreshInterval);
      state.refreshInterval = undefined;
      state.refreshStartedAt = undefined;
   }
   const bState = bridgeStates.get(telegramId);
   if (bState?.refreshInterval) {
      clearInterval(bState.refreshInterval);
      bState.refreshInterval = undefined;
      bState.refreshStartedAt = undefined;
   }
}

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

      // global error handler -- prevents unhandled rejections from crashing the process
      this.bot.catch((err: any, ctx: any) => {
         console.error('[Bot] Unhandled error in middleware:', err);
         try {
            ctx?.reply?.('An error occurred. Please use /start to continue.');
         } catch {
            // ignore reply failures
         }
      });
   }

   private async showQuotes(
      ctx: any,
      telegramId: number,
      intentId: string
   ): Promise<void> {
      try {
         const quotes = await findQuotesByIntentId(intentId);

         if (quotes.length === 0) {
            const bState0 = bridgeStates.get(telegramId);
            const retryAction = bState0 ? 'bridge' : 'swap';
            const label = bState0 ? 'bridge' : 'swap';
            await ctx.editMessageText(`No quotes available for this ${label}.`, {
               reply_markup: {
                  inline_keyboard: [
                     [{ text: '🔄 Try Again', callback_data: retryAction }],
                     [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                  ],
               },
            });
            swapStates.delete(telegramId);
            bridgeStates.delete(telegramId);
            return;
         }

         const state = swapStates.get(telegramId);
         const bState = bridgeStates.get(telegramId);
         const chainId = state?.chainId || bState?.sourceChainId || 1;

         // fetch target token info for human-readable output
         let targetDecimals = 18;
         let targetSymbol = 'tokens';
         const targetTokenAddr = state?.targetToken || bState?.token;
         if (targetTokenAddr) {
            try {
               const info = await getTokenInfo(chainId, targetTokenAddr);
               targetDecimals = info.decimals;
               targetSymbol = info.symbol;
            } catch {
               // fallback to defaults
            }
         }

         // Build quote display
         let message = '📊 <b>Available Quotes</b>\n\n';
         const buttons: { text: string; callback_data: string }[][] = [];

         for (let i = 0; i < quotes.length; i++) {
            const quote = quotes[i];
            const route = quote.route as any;

            const providerName = formatProviderName(route);
            const outputDisplay = formatTokenAmount(
               quote.estimatedOutput || '0',
               targetDecimals
            );
            const feeDisplay = formatFeeDisplay({
               totalFeeUsd: route?.totalFeeUsd,
               totalFeeWei: quote.totalFee || undefined,
               gasPriceGwei: route?.gasPriceGwei,
            });

            message += `<b>${i + 1}. ${providerName}</b>\n`;
            message += `💰 Output: ${outputDisplay} ${targetSymbol}\n`;
            message += `⛽ Fee: ${feeDisplay}\n\n`;

            buttons.push([
               {
                  text: `✅ Select ${providerName}`,
                  callback_data: `swap_accept_${quote.id}`,
               },
            ]);
         }

         buttons.push([{ text: '❌ Cancel', callback_data: 'back_to_main' }]);

         await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: {
               inline_keyboard: buttons,
            },
         });

         // start auto-refresh if we have params to re-quote
         const hasSwapRefresh = state?.chainId && state?.sourceToken && state?.targetToken && state?.amount;
         const hasBridgeRefresh = bState?.sourceChainId && bState?.targetChainId && bState?.token && bState?.amount;
         if (hasSwapRefresh || hasBridgeRefresh) {
            stopRefresh(telegramId);
            const startedAt = Date.now();
            const refreshOwner = (state || bState)!;
            refreshOwner.refreshStartedAt = startedAt;

            // capture DB quote IDs so buttons stay stable during refresh
            const quoteIds = quotes.map(q => q.id);

            refreshOwner.refreshInterval = setInterval(async () => {
               try {
                  const elapsed = Date.now() - startedAt;
                  if (elapsed >= REFRESH_TIMEOUT_MS) {
                     stopRefresh(telegramId);

                     // show timeout message with retry / cancel
                     try {
                        await ctx.editMessageText(
                           'Quote refresh timed out. Prices may be stale.',
                           {
                              reply_markup: {
                                 inline_keyboard: [
                                    [{ text: 'Refresh Quotes', callback_data: 'swap_retry_quotes' }],
                                    [{ text: 'Cancel', callback_data: 'swap' }],
                                 ],
                              },
                           }
                        );
                     } catch {
                        // ignore edit failures
                     }
                     return;
                  }

                  const freshQuotes = await quoteService.fetchQuotes({
                     sourceChainId: state?.chainId || bState!.sourceChainId!,
                     targetChainId: bState?.targetChainId || state!.chainId!,
                     sourceToken: state?.sourceToken || bState!.token!,
                     targetToken: state?.targetToken || bState!.token!,
                     sourceAmount: state?.amount || bState!.amount!,
                     slippageBps: 50,
                  });

                  if (freshQuotes.length === 0) return;

                  const remaining = Math.ceil((REFRESH_TIMEOUT_MS - elapsed) / 1000);
                  let refreshMsg = `📊 <b>Available Quotes</b> (live - ${remaining}s)\n\n`;
                  const refreshButtons: { text: string; callback_data: string }[][] = [];

                  for (let i = 0; i < freshQuotes.length; i++) {
                     const fq = freshQuotes[i];
                     const provName = formatProviderName(fq.route);
                     const outDisplay = formatTokenAmount(
                        fq.estimatedOutput || '0',
                        targetDecimals
                     );
                     const feeDsp = formatFeeDisplay({
                        totalFeeUsd: fq.route.totalFeeUsd || fq.totalFeeUsd,
                        totalFeeWei: fq.totalFee || undefined,
                        gasPriceGwei: fq.route.gasPriceGwei,
                     });

                     refreshMsg += `<b>${i + 1}. ${provName}</b>\n`;
                     refreshMsg += `💰 Output: ${outDisplay} ${targetSymbol}\n`;
                     refreshMsg += `⛽ Fee: ${feeDsp}\n\n`;

                     // use original DB quote ID so acceptance works
                     const btnQuoteId = quoteIds[i] || quoteIds[0];
                     refreshButtons.push([
                        {
                           text: `✅ Select ${provName}`,
                           callback_data: `swap_accept_${btnQuoteId}`,
                        },
                     ]);
                  }

                  refreshButtons.push([{ text: '❌ Cancel', callback_data: 'back_to_main' }]);

                  await ctx.editMessageText(refreshMsg, {
                     parse_mode: 'HTML',
                     reply_markup: { inline_keyboard: refreshButtons },
                  });
               } catch (err: any) {
                  // silently swallow "message is not modified" errors from Telegram
                  if (err?.description?.includes('message is not modified')) return;
                  // skip this tick on transient errors, don't stop interval
               }
            }, REFRESH_INTERVAL_MS);

            if (state) swapStates.set(telegramId, state);
            if (bState) bridgeStates.set(telegramId, bState);
         }
      } catch (error) {
         console.error('Error showing quotes:', error);
         try {
            await ctx.editMessageText('Error loading quotes. Please try again.');
         } catch {
            // ignore secondary failures
         }
      }
   }

   private async getNativeBalance(address: Address, chainId: number = 1): Promise<string> {
      try {
         const rpcUrl = getRpcUrlForChain(chainId);
         const client = getViemClient(chainId, rpcUrl);
         const balance = await client.getBalance({ address });
         return formatEther(balance);
      } catch (error) {
         console.error(`Error fetching balance for chain ${chainId}:`, error);
         return '0.00';
      }
   }

   // shared logic for creating intent and polling for quotes
   private async createIntentAndFetchQuotes(
      ctx: any,
      telegramId: number,
      state: SwapState,
      replyMsg?: any
   ): Promise<void> {
      if (
         !state.userId ||
         !state.chainId ||
         !state.sourceToken ||
         !state.targetToken ||
         !state.amount
      ) {
         await ctx.reply('Missing swap data. Please start again.');
         return;
      }

      try {
         if (replyMsg) {
            await ctx.telegram.editMessageText(
               replyMsg.chat.id,
               replyMsg.message_id,
               undefined,
               '⏳ Fetching quotes...'
            );
         } else {
            await ctx.editMessageText('⏳ Fetching quotes...');
         }
      } catch {
         // ignore edit failures
      }

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

      // poll for quotes
      let attempts = 0;
      const maxAttempts = 30;
      const useCtx = replyMsg
         ? {
              editMessageText: (text: string, opts?: any) =>
                 ctx.telegram.editMessageText(
                    replyMsg.chat.id,
                    replyMsg.message_id,
                    undefined,
                    text,
                    opts
                 ),
           }
         : ctx;

      const pollInterval = setInterval(async () => {
         attempts++;
         try {
            const currentIntent = await intentService.getIntentById(intent.id);

            if (currentIntent?.state === 'QUOTED') {
               clearInterval(pollInterval);
               await this.showQuotes(useCtx, telegramId, intent.id);
            } else if (currentIntent?.state === 'FAILED') {
               clearInterval(pollInterval);
               await useCtx.editMessageText(
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
               await useCtx.editMessageText(
                  'Quote request timed out.',
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: 'Retry', callback_data: 'swap_retry_quotes' }],
                           [{ text: 'Main Menu', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
               // keep swap state so retry can reuse the same parameters
            }
         } catch (err) {
            console.error('Error polling for quotes:', err);
         }
      }, 1000);
   }

   // shared logic for creating bridge intent and polling for quotes
   private async createBridgeIntentAndFetchQuotes(
      ctx: any,
      telegramId: number,
      state: BridgeState,
      replyMsg?: any
   ): Promise<void> {
      if (
         !state.userId ||
         !state.sourceChainId ||
         !state.targetChainId ||
         !state.token ||
         !state.amount
      ) {
         await ctx.reply('Missing bridge data. Please start again.');
         return;
      }

      try {
         if (replyMsg) {
            await ctx.telegram.editMessageText(
               replyMsg.chat.id,
               replyMsg.message_id,
               undefined,
               '⏳ Fetching bridge quotes...'
            );
         } else {
            await ctx.editMessageText('⏳ Fetching bridge quotes...');
         }
      } catch {
         // ignore edit failures
      }

      const rawMessage = JSON.stringify({
         action: 'bridge',
         sourceChainId: state.sourceChainId,
         targetChainId: state.targetChainId,
         sourceToken: state.token,
         targetToken: state.token,
         amount: state.amount,
      });

      const intent = await intentService.createIntent({
         userId: state.userId,
         rawMessage,
      });

      state.intentId = intent.id;
      state.step = 'pending';
      bridgeStates.set(telegramId, state);

      // poll for quotes
      let attempts = 0;
      const maxAttempts = 30;
      const useCtx = replyMsg
         ? {
              editMessageText: (text: string, opts?: any) =>
                 ctx.telegram.editMessageText(
                    replyMsg.chat.id,
                    replyMsg.message_id,
                    undefined,
                    text,
                    opts
                 ),
           }
         : ctx;

      const pollInterval = setInterval(async () => {
         attempts++;
         try {
            const currentIntent = await intentService.getIntentById(intent.id);

            if (currentIntent?.state === 'QUOTED') {
               clearInterval(pollInterval);
               await this.showQuotes(useCtx, telegramId, intent.id);
            } else if (currentIntent?.state === 'FAILED') {
               clearInterval(pollInterval);
               await useCtx.editMessageText(
                  `❌ Failed to get bridge quotes: ${currentIntent.errorMessage || 'Unknown error'}`,
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '🔄 Try Again', callback_data: 'bridge' }],
                           [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
               bridgeStates.delete(telegramId);
            } else if (attempts >= maxAttempts) {
               clearInterval(pollInterval);
               await useCtx.editMessageText(
                  'Bridge quote request timed out.',
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: 'Retry', callback_data: 'bridge_retry_quotes' }],
                           [{ text: 'Main Menu', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
               // keep bridge state so retry can reuse parameters
            }
         } catch (err) {
            console.error('Error polling for bridge quotes:', err);
         }
      }, 1000);
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

      // fetch supported chains from DB, filtered to those with RPC configured
      const activeChains = await findActiveChains();
      const chains = activeChains.filter(c => hasRpcConfigured(c.id));
      if (chains.length === 0) {
         chains.push({ id: 1, name: 'Ethereum', nativeToken: 'ETH' } as any);
      }

      // fetch balances for active chains in parallel
      const balancePromises = chains.map(async chain => {
         const balance = await this.getNativeBalance(wallet.address as Address, chain.id);
         return { chain, balance };
      });
      const balances = await Promise.all(balancePromises);

      let balanceLines = '';
      for (const { chain, balance } of balances) {
         const balanceNum = Number(balance);
         if (balanceNum > 0) {
            balanceLines += `${chain.name}: ${Number(balance).toFixed(4)} ${chain.nativeToken}\n`;
         }
      }
      if (!balanceLines) {
         balanceLines = `${chains[0].nativeToken}: 0.00\n`;
      }

      const message = `🏠 OneTripleC

<b>💳 Wallet:</b>
<code>${wallet.address}</code>

<b>💰 Balance:</b>
${balanceLines.trim()}`;

      const keyboard = {
         parse_mode: 'HTML' as const,
         reply_markup: {
            inline_keyboard: [
               [
                  { text: '🔄 Swap', callback_data: 'swap' },
                  { text: '🌉 Bridge', callback_data: 'bridge' },
               ],
               [{ text: '🌐 Cross-Chain', callback_data: 'cross_chain' }],
               [
                  {
                     text: '💰 Refresh Balance',
                     callback_data: 'refresh_balance',
                  },
               ],
               [{ text: '👛 Wallet', callback_data: 'wallet' }],
            ],
         },
      };

      if (editMessage && ctx.callbackQuery?.message) {
         try {
            await ctx.editMessageText(message, keyboard);
         } catch {
            // fallback to new message if edit fails
            await ctx.reply(message, keyboard);
         }
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

               const message = `🎉 Welcome to OneTripleC!

I help you swap tokens across chains with ONE confirmation.

✅ Your wallet has been created.

<b>📍 Address:</b>
<code>${wallet.address}</code>

<b>🔑 Private Key:</b>
<code>${privateKey}</code>

⚠️ <b>IMPORTANT:</b> Save your private key securely. This is the only time it will be shown.`;

               await ctx.reply(message, {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '▶️ Start', callback_data: 'start' }],
                        [{ text: '⚙️ Settings', callback_data: 'settings' }],
                        [{ text: '❓ Help', callback_data: 'help' }],
                     ],
                  },
               });
            } else {
               // Existing user - go directly to main menu
               await this.showMainMenu(ctx, user.id);
            }
         } catch (error) {
            console.error('Error in /start handler:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
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
         try {
            await ctx.answerCbQuery();
            await ctx.reply('⚙️ Settings functionality coming soon!');
         } catch (error) {
            console.error('Error in settings handler:', error);
         }
      });

      // Handle Help button
      this.bot.action('help', async ctx => {
         try {
            await ctx.answerCbQuery();
            const helpMessage = `❓ <b>How to use OneTripleC:</b>

1️⃣ Use the menu buttons to initiate swaps, bridges, or cross-chain transactions

2️⃣ I'll find the best route and show you options

3️⃣ Confirm the transaction

4️⃣ Done! I'll notify you when complete.`;
            await ctx.reply(helpMessage, { parse_mode: 'HTML' });
         } catch (error) {
            console.error('Error in help handler:', error);
         }
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

            stopRefresh(telegramId);
            bridgeStates.delete(telegramId);

            // Get user
            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            swapStates.set(telegramId, {
               step: 'chain',
               userId: user.id,
            });

            // load chains from DB, filtered to those with RPC configured
            const activeChains = await findActiveChains();
            const chains = activeChains.filter(c => hasRpcConfigured(c.id));
            if (chains.length === 0) {
               chains.push({ id: 1, name: 'Ethereum', nativeToken: 'ETH' } as any);
            }

            await ctx.editMessageText(
               `🔄 <b>Swap Tokens</b>

Select the network for your swap:`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...chains.map(chain => [
                           {
                              text: `🔗 ${chain.name}`,
                              callback_data: `swap_chain_${chain.id}`,
                           },
                        ]),
                        [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in swap handler:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
         }
      });

      // Handle chain selection
      this.bot.action(/^swap_chain_(\d+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const chainId = parseInt(ctx.match[1]);

            // load chain info from DB
            const activeChains = await findActiveChains();
            const chain = activeChains.find(c => c.id === chainId);
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

            // load tokens from DB
            const dbTokens = await findTokensByChainId(chainId);
            const tokenButtons = dbTokens.map(t => ({
               text: t.symbol,
               callback_data: `swap_source_${t.address}`,
            }));
            // arrange in rows of 3
            const tokenRows: { text: string; callback_data: string }[][] = [];
            for (let i = 0; i < tokenButtons.length; i += 3) {
               tokenRows.push(tokenButtons.slice(i, i + 3));
            }

            await ctx.editMessageText(
               `🔄 <b>Swap on ${chain.name}</b>

Select the <b>source token</b> (the token you want to sell):

💡 Or paste a token contract address`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...tokenRows,
                        [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in chain selection:', error);
         }
      });

      // Handle source token quick-select
      this.bot.action(/^swap_source_(0x[a-fA-F0-9]{40})$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state || state.step !== 'sourceToken') return;

            state.sourceToken = ctx.match[1];
            state.step = 'amount';
            swapStates.set(telegramId, state);

            await ctx.editMessageText(
               `✅ Source token set

Now enter the <b>amount</b> to swap:

💡 Example: <code>1.5</code>`,
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
            console.error('Error in source token selection:', error);
         }
      });

      // Handle target token quick-select
      this.bot.action(/^swap_target_(0x[a-fA-F0-9]{40})$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state || state.step !== 'targetToken') return;

            state.targetToken = ctx.match[1];
            state.step = 'pending';
            swapStates.set(telegramId, state);

            // skip confirmation, go straight to quotes
            await this.createIntentAndFetchQuotes(ctx, telegramId, state);
         } catch (error) {
            console.error('Error in target token selection:', error);
         }
      });

      // Handle text input for swap and bridge flows
      this.bot.on('text', async ctx => {
         try {
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            const bridgeState = bridgeStates.get(telegramId);
            if (!state && !bridgeState) return; // no active flow

            const text = ctx.message.text.trim();

            // bridge amount handling
            if (bridgeState && bridgeState.step === 'amount') {
               const amount = parseFloat(text);
               if (isNaN(amount) || amount <= 0) {
                  await ctx.reply(
                     '⚠️ Invalid amount. Please enter a positive number.'
                  );
                  return;
               }

               // get token decimals for proper conversion
               let decimals = 18;
               if (bridgeState.token) {
                  try {
                     const info = await getTokenInfo(
                        bridgeState.sourceChainId || 1,
                        bridgeState.token
                     );
                     decimals = info.decimals;
                  } catch {
                     // fallback to 18
                  }
               }

               bridgeState.displayAmount = text;
               bridgeState.amount = parseUnits(text, decimals).toString();
               bridgeStates.set(telegramId, bridgeState);

               const loadingMsg = await ctx.reply('⏳ Fetching bridge quotes...');
               await this.createBridgeIntentAndFetchQuotes(
                  ctx,
                  telegramId,
                  bridgeState,
                  loadingMsg
               );
               return;
            }

            if (!state) return;

            if (state.step === 'sourceToken') {
               // Validate token address
               if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
                  await ctx.reply(
                     '⚠️ Invalid token address. Please enter a valid Ethereum address starting with 0x'
                  );
                  return;
               }

               state.sourceToken = text;
               state.step = 'amount';
               swapStates.set(telegramId, state);

               await ctx.reply(
                  `✅ Source token set

Now enter the <b>amount</b> to swap:

💡 Example: <code>1.5</code>`,
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
                  await ctx.reply(
                     '⚠️ Invalid amount. Please enter a positive number.'
                  );
                  return;
               }

               // get source token decimals for proper conversion
               let decimals = 18;
               if (state.sourceToken) {
                  try {
                     const info = await getTokenInfo(state.chainId || 1, state.sourceToken);
                     decimals = info.decimals;
                  } catch {
                     // fallback to 18
                  }
               }

               state.displayAmount = text;
               state.amount = parseUnits(text, decimals).toString();
               state.step = 'targetToken';
               swapStates.set(telegramId, state);

               const chainId = state.chainId || 1;
               // load tokens from DB
               const dbTokens = await findTokensByChainId(chainId);
               // filter out source token from target options
               const targetTokens = dbTokens.filter(
                  t => t.address.toLowerCase() !== state.sourceToken?.toLowerCase()
               );
               const tokenButtons = targetTokens.map(t => ({
                  text: t.symbol,
                  callback_data: `swap_target_${t.address}`,
               }));
               const tokenRows: { text: string; callback_data: string }[][] = [];
               for (let i = 0; i < tokenButtons.length; i += 3) {
                  tokenRows.push(tokenButtons.slice(i, i + 3));
               }

               await ctx.reply(
                  `✅ Amount set: ${text}

Select the <b>target token</b> (the token you want to buy):

💡 Or paste a token contract address`,
                  {
                     parse_mode: 'HTML',
                     reply_markup: {
                        inline_keyboard: [
                           ...tokenRows,
                           [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
            } else if (state.step === 'targetToken') {
               // Validate token address
               if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
                  await ctx.reply(
                     '⚠️ Invalid token address. Please enter a valid Ethereum address starting with 0x'
                  );
                  return;
               }

               state.targetToken = text;
               state.step = 'pending';
               swapStates.set(telegramId, state);

               // skip confirmation, go straight to quotes
               const loadingMsg = await ctx.reply('⏳ Fetching quotes...');
               await this.createIntentAndFetchQuotes(ctx, telegramId, state, loadingMsg);
            }
         } catch (error) {
            console.error('Error handling text input:', error);
         }
      });

      // Handle retry after quote timeout -- reuses existing swap state
      this.bot.action('swap_retry_quotes', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state || !state.userId || !state.chainId || !state.sourceToken || !state.targetToken || !state.amount) {
               await ctx.editMessageText('Session expired. Please start a new swap.', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: 'New Swap', callback_data: 'swap' }],
                        [{ text: 'Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               });
               swapStates.delete(telegramId);
               return;
            }

            state.step = 'pending';
            swapStates.set(telegramId, state);
            await this.createIntentAndFetchQuotes(ctx, telegramId, state);
         } catch (error) {
            console.error('Error retrying quotes:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
         }
      });

      // Handle get quotes action (legacy, kept for any remaining references)
      this.bot.action('swap_get_quotes', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = swapStates.get(telegramId);
            if (!state) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            state.step = 'pending';
            swapStates.set(telegramId, state);
            await this.createIntentAndFetchQuotes(ctx, telegramId, state);
         } catch (error) {
            console.error('Error getting quotes:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
         }
      });

      // Handle quote selection (works for both swap and bridge)
      this.bot.action(/^swap_accept_(\S+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            stopRefresh(telegramId);

            const quoteId = ctx.match[1];
            const swapState = swapStates.get(telegramId);
            const bridgeState = bridgeStates.get(telegramId);
            const intentId = swapState?.intentId || bridgeState?.intentId;
            const isBridge = !!bridgeState?.intentId;

            if (!intentId) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            await ctx.editMessageText(isBridge ? '🔄 Executing bridge...' : '🔄 Executing swap...');

            try {
               const result = await intentService.acceptIntent(
                  intentId,
                  quoteId
               );

               // Poll for execution status
               let attempts = 0;
               const maxAttempts = 60; // 60 seconds max
               const pollInterval = setInterval(async () => {
                  attempts++;
                  try {
                     const execution = await findExecutionById(
                        result.executionId
                     );

                     if (execution?.state === 'CONFIRMED') {
                        clearInterval(pollInterval);
                        const execChainId = swapState?.chainId || bridgeState?.sourceChainId || 1;
                        const explorerUrl = await getExplorerUrl(execChainId);
                        const txLink = explorerUrl
                           ? `${explorerUrl}/tx/${execution.txHash}`
                           : '';

                        let completeMsg: string;
                        let actionButtons: { text: string; callback_data: string }[][];

                        if (isBridge) {
                           const destChain = await findChainById(bridgeState!.targetChainId!);
                           const destName = destChain?.name || `Chain ${bridgeState!.targetChainId}`;
                           completeMsg = `✅ <b>Bridge Initiated!</b>

Funds will arrive on ${destName} in ~2-10 minutes.

Transaction hash:
<code>${execution.txHash}</code>

${txLink ? `<a href="${txLink}">🔍 View on Explorer</a>` : ''}`;
                           actionButtons = [
                              [{ text: '🌉 New Bridge', callback_data: 'bridge' }],
                              [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                           ];
                        } else {
                           completeMsg = `✅ <b>Swap Complete!</b>

Transaction hash:
<code>${execution.txHash}</code>

${txLink ? `<a href="${txLink}">🔍 View on Explorer</a>` : ''}`;
                           actionButtons = [
                              [{ text: '🔄 New Swap', callback_data: 'swap' }],
                              [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                           ];
                        }

                        await ctx.editMessageText(completeMsg, {
                           parse_mode: 'HTML',
                           reply_markup: { inline_keyboard: actionButtons },
                        });
                        swapStates.delete(telegramId);
                        bridgeStates.delete(telegramId);
                     } else if (execution?.state === 'FAILED') {
                        clearInterval(pollInterval);
                        const retryAction = isBridge ? 'bridge' : 'swap';
                        const label = isBridge ? 'Bridge' : 'Swap';
                        await ctx.editMessageText(
                           `❌ <b>${label} Failed</b>

Error: ${execution.errorMessage || 'Unknown error'}`,
                           {
                              parse_mode: 'HTML',
                              reply_markup: {
                                 inline_keyboard: [
                                    [{ text: '🔄 Try Again', callback_data: retryAction }],
                                    [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                                 ],
                              },
                           }
                        );
                        swapStates.delete(telegramId);
                        bridgeStates.delete(telegramId);
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
                        bridgeStates.delete(telegramId);
                     }
                  } catch (err) {
                     console.error('Error polling execution:', err);
                  }
               }, 1000);
            } catch (error: any) {
               const retryAction = isBridge ? 'bridge' : 'swap';
               const label = isBridge ? 'bridge' : 'swap';
               try {
                  await ctx.editMessageText(
                     `❌ Failed to execute ${label}: ${error.message || 'Unknown error'}`,
                     {
                        reply_markup: {
                           inline_keyboard: [
                              [{ text: '🔄 Try Again', callback_data: retryAction }],
                              [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                           ],
                        },
                     }
                  );
               } catch {
                  // ignore secondary failures
               }
               swapStates.delete(telegramId);
               bridgeStates.delete(telegramId);
            }
         } catch (error) {
            console.error('Error accepting quote:', error);
         }
      });

      // Bridge flow -- source chain selection
      this.bot.action('bridge', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) {
               await ctx.reply('Error: Could not identify user');
               return;
            }

            stopRefresh(telegramId);
            swapStates.delete(telegramId);

            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            bridgeStates.set(telegramId, {
               step: 'sourceChain',
               userId: user.id,
            });

            // load chains from DB, filtered to those with RPC + Across spoke pool
            const activeChains = await findActiveChains();
            const chains = activeChains.filter(
               c => hasRpcConfigured(c.id) && ACROSS_CHAIN_IDS.has(c.id)
            );

            if (chains.length === 0) {
               await ctx.editMessageText(
                  'No bridge-supported chains available.',
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                        ],
                     },
                  }
               );
               bridgeStates.delete(telegramId);
               return;
            }

            await ctx.editMessageText(
               `🌉 <b>Bridge Tokens</b>\n\nSelect the <b>source chain</b> (where your tokens are):`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...chains.map(chain => [
                           {
                              text: `🔗 ${chain.name}`,
                              callback_data: `bridge_src_${chain.id}`,
                           },
                        ]),
                        [{ text: '❌ Cancel', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in bridge handler:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
         }
      });

      // Bridge -- destination chain selection
      this.bot.action(/^bridge_src_(\d+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const sourceChainId = parseInt(ctx.match[1]);
            const state = bridgeStates.get(telegramId);
            if (!state) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            state.sourceChainId = sourceChainId;
            state.step = 'targetChain';
            bridgeStates.set(telegramId, state);

            // show destination chains (exclude source, filter to Across-supported)
            const activeChains = await findActiveChains();
            const destChains = activeChains.filter(
               c => c.id !== sourceChainId && hasRpcConfigured(c.id) && ACROSS_CHAIN_IDS.has(c.id)
            );

            const sourceChain = await findChainById(sourceChainId);
            const sourceName = sourceChain?.name || `Chain ${sourceChainId}`;

            await ctx.editMessageText(
               `🌉 <b>Bridge from ${sourceName}</b>\n\nSelect the <b>destination chain</b>:`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...destChains.map(chain => [
                           {
                              text: `🔗 ${chain.name}`,
                              callback_data: `bridge_dst_${chain.id}`,
                           },
                        ]),
                        [{ text: '⬅️ Back', callback_data: 'bridge' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in bridge source chain handler:', error);
         }
      });

      // Bridge -- token selection
      this.bot.action(/^bridge_dst_(\d+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const targetChainId = parseInt(ctx.match[1]);
            const state = bridgeStates.get(telegramId);
            if (!state || !state.sourceChainId) {
               await ctx.reply('Session expired. Please start again.');
               return;
            }

            state.targetChainId = targetChainId;
            state.step = 'token';
            bridgeStates.set(telegramId, state);

            // load tokens from DB for source chain
            const dbTokens = await findTokensByChainId(state.sourceChainId);
            const tokenButtons = dbTokens.map(t => ({
               text: t.symbol,
               callback_data: `bridge_token_${t.address}`,
            }));
            const tokenRows: { text: string; callback_data: string }[][] = [];
            for (let i = 0; i < tokenButtons.length; i += 3) {
               tokenRows.push(tokenButtons.slice(i, i + 3));
            }

            const sourceChain = await findChainById(state.sourceChainId);
            const destChain = await findChainById(targetChainId);
            const sourceName = sourceChain?.name || `Chain ${state.sourceChainId}`;
            const destName = destChain?.name || `Chain ${targetChainId}`;

            await ctx.editMessageText(
               `🌉 <b>Bridge: ${sourceName} → ${destName}</b>\n\nSelect the token to bridge:`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        ...tokenRows,
                        [{ text: '⬅️ Back', callback_data: 'bridge' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in bridge dest chain handler:', error);
         }
      });

      // Bridge -- amount prompt
      this.bot.action(/^bridge_token_(0x[a-fA-F0-9]{40})$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = bridgeStates.get(telegramId);
            if (!state || state.step !== 'token') return;

            state.token = ctx.match[1];
            state.step = 'amount';
            bridgeStates.set(telegramId, state);

            await ctx.editMessageText(
               `✅ Token selected\n\nEnter the <b>amount</b> to bridge:\n\n💡 Example: <code>100</code>`,
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
            console.error('Error in bridge token handler:', error);
         }
      });

      // Bridge -- retry after quote timeout
      this.bot.action('bridge_retry_quotes', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const state = bridgeStates.get(telegramId);
            if (!state || !state.userId || !state.sourceChainId || !state.targetChainId || !state.token || !state.amount) {
               await ctx.editMessageText('Session expired. Please start a new bridge.', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: 'New Bridge', callback_data: 'bridge' }],
                        [{ text: 'Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               });
               bridgeStates.delete(telegramId);
               return;
            }

            state.step = 'pending';
            bridgeStates.set(telegramId, state);
            await this.createBridgeIntentAndFetchQuotes(ctx, telegramId, state);
         } catch (error) {
            console.error('Error retrying bridge quotes:', error);
            try {
               await ctx.reply('An error occurred. Please try again.');
            } catch {
               // ignore secondary failures
            }
         }
      });

      this.bot.action('cross_chain', async ctx => {
         try {
            await ctx.answerCbQuery();
            await ctx.reply('🌐 Cross-chain functionality coming soon!');
         } catch (error) {
            console.error('Error in cross_chain handler:', error);
         }
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

      // Wallet management
      this.bot.action('wallet', async ctx => {
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

            const allWallets = await this.walletService.getAllWalletsByUserId(user.id);
            if (allWallets.length === 0) {
               await ctx.editMessageText('No wallets found. Creating one...', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               });
               return;
            }

            let message = '👛 <b>Wallet list:</b>\n\n';
            const buttons: { text: string; callback_data: string }[][] = [];

            for (let i = 0; i < allWallets.length; i++) {
               const w = allWallets[i];
               const activeLabel = w.isActive ? ' ✅' : '';
               message += `${i + 1}. <code>${w.address}</code>${activeLabel}\n`;
            }

            message += '\n<i>✅ = active wallet</i>';

            // wallet action buttons
            buttons.push([
               { text: '🔑 Show Private Key', callback_data: 'show_private_key' },
            ]);
            buttons.push([
               { text: '➕ Add Wallet', callback_data: 'add_wallet' },
            ]);
            if (allWallets.length > 1) {
               buttons.push([
                  { text: '🔀 Change Active Wallet', callback_data: 'change_active_wallet' },
               ]);
               buttons.push([
                  { text: '🗑️ Delete Wallet', callback_data: 'delete_wallet' },
               ]);
            }
            buttons.push([{ text: '🏠 Back', callback_data: 'back_to_main' }]);

            if (ctx.callbackQuery?.message) {
               await ctx.editMessageText(message, {
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: buttons },
               });
            } else {
               await ctx.reply(message, {
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: buttons },
               });
            }
         } catch (error) {
            console.error('Error in wallet handler:', error);
         }
      });

      // Add new wallet
      this.bot.action('add_wallet', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            const newWallet = await this.walletService.generateWalletForUser(user.id);
            const privateKey = await this.walletService.getPrivateKey(newWallet.id);

            await ctx.editMessageText(
               `✅ <b>New wallet created!</b>

<b>📍 Address:</b>
<code>${newWallet.address}</code>

<b>🔑 Private Key:</b>
<code>${privateKey}</code>

⚠️ Save your private key securely. This is the only time it will be shown.`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                        [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               }
            );
         } catch (error: any) {
            console.error('Error adding wallet:', error);
            try {
               await ctx.editMessageText(
                  `❌ Error creating wallet: ${error.message || 'Unknown error'}`,
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                        ],
                     },
                  }
               );
            } catch {
               // ignore secondary failures
            }
         }
      });

      // Show private key of active wallet
      this.bot.action('show_private_key', async ctx => {
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

            const wallet = await this.walletService.getWalletByUserId(user.id);
            if (!wallet) {
               await ctx.reply('Error: Wallet not found');
               return;
            }

            const privateKey = await this.walletService.getPrivateKey(
               wallet.id
            );

            await ctx.reply(
               `⚠️ <b>SECURITY WARNING</b> ⚠️

🔑 Your Private Key:
<code>${privateKey}</code>

🚨 NEVER share this with anyone!
Anyone with this key has full access to your wallet.`,
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in show_private_key handler:', error);
         }
      });

      // Change active wallet - show wallet selection
      this.bot.action('change_active_wallet', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            const allWallets = await this.walletService.getAllWalletsByUserId(user.id);
            if (allWallets.length <= 1) {
               await ctx.editMessageText('You only have one wallet.', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                     ],
                  },
               });
               return;
            }

            let message = '🔀 <b>Select active wallet:</b>\n\n';
            const buttons: { text: string; callback_data: string }[][] = [];

            for (let i = 0; i < allWallets.length; i++) {
               const w = allWallets[i];
               const activeLabel = w.isActive ? ' ✅' : '';
               const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
               message += `${i + 1}. <code>${w.address}</code>${activeLabel}\n`;
               if (!w.isActive) {
                  buttons.push([
                     {
                        text: `Set ${shortAddr} active`,
                        callback_data: `set_active_${w.id}`,
                     },
                  ]);
               }
            }

            buttons.push([{ text: '👛 Back to Wallets', callback_data: 'wallet' }]);

            await ctx.editMessageText(message, {
               parse_mode: 'HTML',
               reply_markup: { inline_keyboard: buttons },
            });
         } catch (error) {
            console.error('Error in change_active_wallet handler:', error);
         }
      });

      // Set a specific wallet as active
      this.bot.action(/^set_active_(\S+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const walletId = ctx.match[1];
            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            await this.walletService.setActiveWallet(walletId, user.id);

            await ctx.editMessageText('✅ Active wallet changed!', {
               reply_markup: {
                  inline_keyboard: [
                     [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                     [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                  ],
               },
            });
         } catch (error) {
            console.error('Error setting active wallet:', error);
         }
      });

      // Delete wallet - show wallet selection
      this.bot.action('delete_wallet', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            const allWallets = await this.walletService.getAllWalletsByUserId(user.id);
            if (allWallets.length <= 1) {
               await ctx.editMessageText('⚠️ Cannot delete the only wallet.', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                     ],
                  },
               });
               return;
            }

            let message = '🗑️ <b>Select wallet to delete:</b>\n\n';
            const buttons: { text: string; callback_data: string }[][] = [];

            for (let i = 0; i < allWallets.length; i++) {
               const w = allWallets[i];
               const activeLabel = w.isActive ? ' ✅' : '';
               const shortAddr = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
               message += `${i + 1}. <code>${w.address}</code>${activeLabel}\n`;
               buttons.push([
                  {
                     text: `🗑️ Delete ${shortAddr}`,
                     callback_data: `confirm_delete_${w.id}`,
                  },
               ]);
            }

            buttons.push([{ text: '👛 Back to Wallets', callback_data: 'wallet' }]);

            await ctx.editMessageText(message, {
               parse_mode: 'HTML',
               reply_markup: { inline_keyboard: buttons },
            });
         } catch (error) {
            console.error('Error in delete_wallet handler:', error);
         }
      });

      // Confirm wallet deletion
      this.bot.action(/^confirm_delete_(\S+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const walletId = ctx.match[1];

            await ctx.editMessageText(
               '⚠️ <b>Are you sure?</b>\n\nThis will permanently delete the wallet and its private key.',
               {
                  parse_mode: 'HTML',
                  reply_markup: {
                     inline_keyboard: [
                        [
                           {
                              text: '✅ Yes, delete',
                              callback_data: `do_delete_${walletId}`,
                           },
                           {
                              text: '❌ Cancel',
                              callback_data: 'wallet',
                           },
                        ],
                     ],
                  },
               }
            );
         } catch (error) {
            console.error('Error in confirm_delete handler:', error);
         }
      });

      // Actually delete wallet
      this.bot.action(/^do_delete_(\S+)$/, async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) return;

            const walletId = ctx.match[1];
            const user = await this.authService.getOrCreateUser({
               provider: 'telegram',
               providerId: telegramId.toString(),
               metadata: {
                  username: ctx.from?.username,
                  first_name: ctx.from?.first_name,
               },
            });

            try {
               await this.walletService.deleteWallet(walletId, user.id);
               await ctx.editMessageText('✅ Wallet deleted.', {
                  reply_markup: {
                     inline_keyboard: [
                        [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                        [{ text: '🏠 Main Menu', callback_data: 'back_to_main' }],
                     ],
                  },
               });
            } catch (error: any) {
               await ctx.editMessageText(
                  `❌ ${error.message || 'Error deleting wallet'}`,
                  {
                     reply_markup: {
                        inline_keyboard: [
                           [{ text: '👛 Back to Wallets', callback_data: 'wallet' }],
                        ],
                     },
                  }
               );
            }
         } catch (error) {
            console.error('Error deleting wallet:', error);
         }
      });

      this.bot.action('back_to_main', async ctx => {
         try {
            await ctx.answerCbQuery();
            const telegramId = ctx.from?.id;
            if (!telegramId) {
               await ctx.reply('Error: Could not identify user');
               return;
            }

            stopRefresh(telegramId);
            swapStates.delete(telegramId);
            bridgeStates.delete(telegramId);

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
            try {
               await ctx.reply('An error occurred. Use /start to return to the main menu.');
            } catch {
               // ignore
            }
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
