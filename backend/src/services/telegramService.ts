import axios from 'axios';
import { env } from '../config/env';

type TelegramSendOptions = {
  parseMode?: 'Markdown' | 'HTML';
  inlineKeyboard?: Array<Array<{ text: string; callbackData: string }>>;
};

export async function sendTelegramMessage(
  telegramUserId: string | number,
  text: string,
  options?: TelegramSendOptions
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: telegramUserId,
      text
    };

    if (options?.parseMode) {
      payload.parse_mode = options.parseMode;
    }

    if (options?.inlineKeyboard && options.inlineKeyboard.length > 0) {
      payload.reply_markup = {
        inline_keyboard: options.inlineKeyboard.map((row) =>
          row.map((button) => ({
            text: button.text,
            callback_data: button.callbackData
          }))
        )
      };
    }

    await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      ...payload
    });
  } catch (error) {
    // Silent fail: the app continues to work without Telegram delivery guarantees.
    console.error('Telegram send error:', error);
  }
}
