export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
export type TelegramReplyMarkup = InlineKeyboard | { force_reply: true; selective?: boolean; input_field_placeholder?: string };

async function callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok || data.result === undefined) throw new Error(`Telegram ${method} failed: ${data.description ?? response.status}`);
  return data.result;
}

export function sendTelegramMessage(chatId: number | bigint, text: string, replyMarkup?: TelegramReplyMarkup) {
  return callTelegram('sendMessage', { chat_id: chatId.toString(), text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

export function answerTelegramCallback(callbackQueryId: string, text: string) {
  return callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
}
