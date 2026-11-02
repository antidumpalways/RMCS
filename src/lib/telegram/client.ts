export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> };
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
  return callTelegram<{ message_id?: number }>('sendMessage', { chat_id: chatId.toString(), text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

// Jawaban tombol hanya valid beberapa detik. Kalau sudah kedaluwarsa (mis. penyimpanan rekap lambat),
// itu tidak boleh menggagalkan pesan: data sudah diproses dan Telegram akan mengulang pesan yang sama.
export async function tryAnswerTelegramCallback(callbackQueryId: string, text: string): Promise<boolean> {
  if (!callbackQueryId) return false;
  try {
    await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
    return true;
  } catch (error) {
    console.warn('answerCallbackQuery skipped:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

export async function answerTelegramCallback(callbackQueryId: string, text: string): Promise<void> {
  await tryAnswerTelegramCallback(callbackQueryId, text);
}

export function deleteTelegramMessage(chatId: number | bigint, messageId: number) {
  return callTelegram('deleteMessage', { chat_id: chatId.toString(), message_id: messageId });
}
