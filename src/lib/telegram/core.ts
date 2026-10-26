export type TelegramCommand = { command: string; args: string };

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const match = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() } : null;
}

export function allowedTelegramGroup(chatId: string | number, chatType: string, configured: string | undefined): boolean {
  if (chatType !== 'group' && chatType !== 'supergroup') return false;
  const allowed = new Set((configured ?? '').split(',').map((value) => value.trim()).filter((value) => /^-?\d+$/.test(value)));
  return allowed.has(String(chatId));
}

export function parseTelegramCallback(data: string | undefined): { operation: 'ok' | 'cancel' | 'edit'; draftId: string; revision?: number } | null {
  const match = /^rcms:(ok|cancel|edit):([A-Za-z0-9_-]{10,40})(?::([0-9]{1,10}))?$/.exec(data ?? '');
  if (!match) return null;
  return { operation: match[1] as 'ok' | 'cancel' | 'edit', draftId: match[2], ...(match[3] ? { revision: Number(match[3]) } : {}) };
}
export function parseCashInput(text: string): bigint | null {
  const match = /^(?:rp\s*)?(\d+(?:\.\d{3})*)$/i.exec(text.trim());
  if (!match) return null;
  const digits = match[1].replaceAll('.', '');
  if (!/^\d{1,13}$/.test(digits)) return null;
  const amount = BigInt(digits);
  return amount <= 1_000_000_000_000n ? amount : null;
}

export function formatTelegramRupiah(value: bigint | number): string {
  const amount = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  const sign = amount < 0n ? '−' : '';
  const absolute = amount < 0n ? -amount : amount;
  return `Rp ${sign}${absolute.toLocaleString('id-ID')}`;
}

export function telegramId(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return BigInt(value);
}

export function duplicateUpdateDisposition(status: string | null, leaseUntil: Date | null, now: Date): 'PROCESSED' | 'BUSY' | 'CLAIMED' {
  if (status === 'PROCESSED') return 'PROCESSED';
  if (status === 'FAILED' || (status === 'PROCESSING' && leaseUntil !== null && leaseUntil < now)) return 'CLAIMED';
  return 'BUSY';
}




