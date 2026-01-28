import { Telegraf, Markup } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';
import { findOrCreateUser } from '../persistence/repositories/user-repository.js';
import { config } from '../shared/config/index.js';

const API_BASE_URL = `http://localhost:${config.PORT}`;

export class BotService {
  private client: TelegramClient;
  private bot: Telegraf;

  constructor(token: string) {
    this.client = new TelegramClient(token);
    this.bot = this.client.getBot();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.start(ctx => {
      ctx.reply(
        'Welcome to OneTripleC!\n\n' +
          'Send me a message like:\n' +
          '• "swap 100 USDC to ETH"\n' +
          '• "bridge 50 ETH from Ethereum to Base"\n' +
          '• "send 1000 USDC to 0x123..."\n\n' +
          "I'll help you execute cross-chain transactions."
      );
    });

    this.bot.help(ctx => {
      ctx.reply(
        'OneTripleC Commands:\n\n' +
          '/start - Start the bot\n' +
          '/help - Show this help message\n\n' +
          'Just send me your intent in plain text:\n' +
          '• "swap 100 USDC to ETH"\n' +
          '• "bridge 50 ETH from Ethereum to Base"'
      );
    });

    this.bot.on('text', async ctx => {
      const message = ctx.message.text;
      const telegramId = ctx.from.id;
      const telegramUsername = ctx.from.username;
      const telegramFirstName = ctx.from.first_name;

      if (message.startsWith('/')) {
        return;
      }

      try {
        const user = await findOrCreateUser({
          telegramId,
          telegramUsername,
          telegramFirstName,
        });

        const statusMessage = await ctx.reply('Processing your intent...');

        const createResponse = await fetch(`${API_BASE_URL}/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            rawMessage: message,
          }),
        });

        if (!createResponse.ok) {
          const error = await createResponse.json();
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMessage.message_id,
            undefined,
            `Failed to create intent: ${error.error?.message || 'Unknown error'}`
          );
          return;
        }

        const { id: intentId } = await createResponse.json();

        await this.pollForQuotes(ctx, intentId, statusMessage.message_id);
      } catch (error) {
        console.error('Error processing message:', error);
        await ctx.reply(
          'Sorry, an error occurred while processing your request.'
        );
      }
    });

    this.bot.on('callback_query', async ctx => {
      const data = ctx.callbackQuery.chat_instance;
      await ctx.answerCbQuery();

      if (!data) return;

      const [action, intentId, quoteId] = data.split(':');

      if (action === 'accept') {
        try {
          const response = await fetch(
            `${API_BASE_URL}/intents/${intentId}/accept`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quoteId }),
            }
          );

          if (!response.ok) {
            const error = await response.json();
            await ctx.editMessageText(
              `Failed to accept quote: ${error.error?.message || 'Unknown error'}`
            );
            return;
          }

          const { executionId, state } = await response.json();

          await ctx.editMessageText(
            `Quote accepted! Execution started.\n\nExecution ID: ${executionId}\nState: ${state}`
          );
        } catch (error) {
          console.error('Error accepting quote:', error);
          await ctx.editMessageText(
            'Failed to accept quote. Please try again.'
          );
        }
      }
    });
  }

  private async pollForQuotes(
    ctx: any,
    intentId: string,
    messageId: number,
    attempts = 0
  ): Promise<void> {
    const maxAttempts = 30;
    const pollInterval = 2000;

    if (attempts >= maxAttempts) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        undefined,
        'Timeout waiting for quotes. Please try again.'
      );
      return;
    }

    try {
      const intentResponse = await fetch(`${API_BASE_URL}/intents/${intentId}`);
      if (!intentResponse.ok) {
        throw new Error('Failed to fetch intent');
      }

      const intent = await intentResponse.json();

      if (intent.state === 'FAILED') {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          messageId,
          undefined,
          `Intent failed: ${intent.errorMessage || 'Unknown error'}`
        );
        return;
      }

      if (intent.state === 'QUOTED') {
        const quotesResponse = await fetch(
          `${API_BASE_URL}/intents/${intentId}/quotes`
        );
        if (!quotesResponse.ok) {
          throw new Error('Failed to fetch quotes');
        }

        const { quotes } = await quotesResponse.json();

        if (quotes.length === 0) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            undefined,
            'No quotes available for this intent.'
          );
          return;
        }

        const buttons = quotes.map((quote: any, index: number) => [
          Markup.button.callback(
            `Option ${index + 1}: ${quote.estimatedOutput} (Fee: ${quote.totalFee})`,
            `accept:${intentId}:${quote.id}`
          ),
        ]);

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          messageId,
          undefined,
          'Here are your quotes:\n\nSelect an option to proceed:',
          Markup.inlineKeyboard(buttons)
        );
        return;
      }

      setTimeout(
        () => this.pollForQuotes(ctx, intentId, messageId, attempts + 1),
        pollInterval
      );
    } catch (error) {
      console.error('Error polling for quotes:', error);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        undefined,
        'Error fetching quotes. Please try again.'
      );
    }
  }

  async start(): Promise<void> {
    await this.bot.launch();
    console.log('Telegram bot started');
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }
}

export async function createBotService(token: string): Promise<BotService> {
  const service = new BotService(token);
  await service.start();
  return service;
}
