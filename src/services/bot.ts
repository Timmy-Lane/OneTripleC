import { Telegraf } from 'telegraf';
import { TelegramClient } from '../adapters/telegram/telegram-client.js';

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
      ctx.reply('Welcome to OneTripleC! Setup is in progress. Check back soon.');
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

export async function createBotService(token: string): Promise<BotService> {
  const service = new BotService(token);
  await service.start();
  return service;
}
