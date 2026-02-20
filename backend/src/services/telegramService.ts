import axios from 'axios';
import { env } from '../config/env';

export async function sendTelegramMessage(telegramUserId: string | number, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: telegramUserId,
      text
    });
  } catch (error) {
    // Silent fail: the app continues to work without Telegram delivery guarantees.
    console.error('Telegram send error:', error);
  }
}
