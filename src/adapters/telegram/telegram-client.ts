import { Telegraf } from 'telegraf';

export interface TelegramMessage {
  chatId: number;
  text: string;
  parseMode?: 'Markdown' | 'HTML';
  replyMarkup?: any;
}

export class TelegramClient {
  private bot: Telegraf;

  constructor(token: string) {
    this.bot = new Telegraf(token);
  }

  async sendMessage(message: TelegramMessage): Promise<void> {
    await this.bot.telegram.sendMessage(message.chatId, message.text, {
      parse_mode: message.parseMode,
      reply_markup: message.replyMarkup,
    });
  }

  async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
    await this.bot.telegram.editMessageText(chatId, messageId, undefined, text);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.bot.telegram.answerCbQuery(callbackQueryId, text);
  }

  getBot(): Telegraf {
    return this.bot;
  }
}
