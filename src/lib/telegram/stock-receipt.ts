// Barang masuk dari grup karyawan (mis. pertalite atau voucher yang baru datang menjelang shift ditutup):
//   Barang masuk:
//   TELKOMSEL 3 HARI : 10
//   AXIS 5 HARI : 5
// Bot menampilkan pratinjau; stok baru bertambah setelah tombol Simpan ditekan (sekali pakai, jadi pesan yang dikirim
// ulang tidak menambah dua kali). Angkanya adalah JUMLAH YANG MASUK, bukan stok akhir.
import { prisma } from '@/lib/prisma';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { resolveCountItems } from './count-extract';
import { parseStockList } from './stock-list';
import type { CountMessage } from './group-count';

const HEADER = /^(?:tolong\s+)?(?:barang|stok|stock)\s+masuk|^(?:tolong\s+)?(?:restock|kulakan|tambah(?:kan|in)?\s+(?:stok|stock))\b/i;
const RECEIPT_TTL = 30 * 60_000;
const MAX_QTY = 10_000;

export function isReceiptMessage(text: string): boolean {
  const lines = text.trim().split(/\r?\n/);
  const first = lines[0] ?? '';
  if (!HEADER.test(first)) return false;
  const rest = first.replace(HEADER, '').replace(/^[\s:.,-]+/, '');
  return lines.length > 1 || /\d/.test(rest);
}

export function parseReceiptMessage(text: string): { items: CountMessage['items']; invalid: string[]; skipped: string[] } | null {
  const lines = text.trim().split(/\r?\n/);
  const first = (lines[0] ?? '').replace(HEADER, '').replace(/^[\s:.,-]+/, '').trim();
  const body = [first, ...lines.slice(1)].filter(Boolean).join(String.fromCharCode(10));
  if (!body) return null;
  const parsed = parseStockList('Update stok' + String.fromCharCode(10) + body, { lenient: true, tolerant: true });
  return parsed ? { items: parsed.items, invalid: parsed.invalid ?? [], skipped: parsed.skipped } : null;
}

type ReceiptPayload = { version: 1; kind: 'STOCK_RECEIPT'; actorName: string; lines: Array<{ productId: number; name: string; qty: number }> };

function receiptKeyboard(id: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: '✅ Simpan barang masuk', callback_data: 'rcms:rcv:ok:' + id }, { text: 'Batal', callback_data: 'rcms:rcv:no:' + id }]] };
}

export async function handleReceiptMessage(chatId: bigint, actor: { identityId: string; displayName: string; linkedUserId: number | null }, text: string) {
  const parsed = parseReceiptMessage(text);
  if (!parsed || !parsed.items.length) {
    return sendTelegramMessage(chatId, 'Barang masuk belum terbaca. Contoh:' + String.fromCharCode(10) + 'Barang masuk:' + String.fromCharCode(10) + 'Telkomsel 3 hari : 10' + String.fromCharCode(10) + 'Axis 5 hari : 5' + String.fromCharCode(10) + '(angkanya jumlah yang masuk, bukan stok akhir)');
  }
  const message: CountMessage = { items: parsed.items, skipped: parsed.skipped, invalid: parsed.invalid, admin: null, total: null, expense: null, events: [] };
  const { counts, duplicateNotes } = await resolveCountItems(message);
  const NL = String.fromCharCode(10);
  const lines: ReceiptPayload['lines'] = [], preview: string[] = [], unknown: string[] = [], merged = new Map<number, number>();
  const catalogStock = new Map<number, { name: string; stock: number }>();
  for (const { item, product } of counts) {
    if (!product) { unknown.push(`${item.label} (${item.stock})`); continue; }
    if (item.stock < 1 || item.stock > MAX_QTY) { unknown.push(`${item.label} (${item.stock}) — jumlah tidak masuk akal`); continue; }
    merged.set(product.id, (merged.get(product.id) ?? 0) + item.stock);
    catalogStock.set(product.id, { name: product.name, stock: product.stock });
  }
  for (const [productId, qty] of merged) {
    const info = catalogStock.get(productId)!;
    lines.push({ productId, name: info.name, qty });
    preview.push(`• ${info.name}: +${qty} (stok ${info.stock} → ${info.stock + qty})`);
  }
  if (!lines.length) {
    return sendTelegramMessage(chatId, ['Tidak ada barang yang dikenali, jadi tidak ada yang disimpan.', unknown.length ? 'Belum ada di katalog: ' + unknown.join(', ') + '. Minta owner menambahkannya dulu.' : ''].filter(Boolean).join(NL));
  }
  const payload: ReceiptPayload = { version: 1, kind: 'STOCK_RECEIPT', actorName: actor.displayName, lines };
  const draft = await prisma.telegramDraft.create({ data: { userId: actor.linkedUserId, telegramIdentityId: actor.identityId, chatId, kind: 'STOCK_RECEIPT', payload: payload as object,
    status: 'PENDING', expiresAt: new Date(Date.now() + RECEIPT_TTL) }, select: { id: true } });
  const out = ['📥 BARANG MASUK (belum disimpan)', ...preview];
  if (unknown.length) out.push('', '⚠️ Belum ada di katalog (tidak ikut disimpan): ' + unknown.join(', ') + '. Minta owner menambahkannya dulu.');
  if (parsed.invalid.length) out.push('', 'Baris ini tidak terbaca dan diabaikan: ' + parsed.invalid.slice(0, 6).join('; ') + '.');
  for (const note of duplicateNotes) out.push('', 'ℹ️ ' + note);
  out.push('', 'Stok baru bertambah setelah kamu tekan Simpan. Hitungan stok akhir shift nanti memakai stok yang sudah termasuk barang masuk ini.');
  return sendTelegramMessage(chatId, out.join(NL), receiptKeyboard(draft.id));
}

export async function handleReceiptCallback(c: { id: string; data?: string; message?: { chat: { id: number | string } } }, notifyOwners: (text: string) => Promise<void>) {
  const match = /^rcms:rcv:(ok|no):([A-Za-z0-9_-]{10,40})$/.exec(c.data ?? '');
  if (!match || !c.message) return answerTelegramCallback(c.id, 'Tombol tidak dikenali.');
  const chatId = BigInt(c.message.chat.id), draftId = match[2];
  const row = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  const payload = row?.payload as Partial<ReceiptPayload> | undefined;
  if (!row || row.kind !== 'STOCK_RECEIPT' || row.chatId !== chatId || row.status !== 'PENDING' || row.expiresAt <= new Date() || payload?.kind !== 'STOCK_RECEIPT' || !Array.isArray(payload.lines)) {
    return answerTelegramCallback(c.id, 'Barang masuk ini sudah diproses atau kedaluwarsa. Tidak ada perubahan.');
  }
  if (match[1] === 'no') {
    await prisma.telegramDraft.updateMany({ where: { id: draftId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await answerTelegramCallback(c.id, 'Dibatalkan.');
    return sendTelegramMessage(chatId, 'Barang masuk dibatalkan. Stok tidak berubah.');
  }
  const applied: string[] = [];
  const ok = await prisma.$transaction(async tx => {
    const claimed = await tx.telegramDraft.updateMany({ where: { id: draftId, chatId, kind: 'STOCK_RECEIPT', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    if (claimed.count !== 1) return false;
    for (const line of payload.lines!) {
      if (!Number.isSafeInteger(line.productId) || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) throw new Error('RECEIPT_INVALID');
      const product = await tx.product.update({ where: { id: line.productId }, data: { stock: { increment: line.qty } }, select: { name: true, stock: true, costPrice: true } });
      await tx.inventoryMovement.create({ data: { productId: line.productId, type: 'IN', qty: line.qty, costAtTime: product.costPrice, note: `Barang masuk Telegram karyawan ${payload.actorName ?? ''}`.trim(), userId: null } });
      applied.push(`• ${product.name}: +${line.qty} → stok ${product.stock}`);
    }
    return true;
  });
  if (!ok) return answerTelegramCallback(c.id, 'Barang masuk ini sudah diproses. Tidak ditambah dua kali.');
  await answerTelegramCallback(c.id, 'Tersimpan.');
  const NL = String.fromCharCode(10);
  await sendTelegramMessage(chatId, ['✅ BARANG MASUK TERSIMPAN', ...applied, '', 'Nanti saat menutup shift, hitung stok akhir seperti biasa.'].join(NL));
  try { await notifyOwners(['📥 BARANG MASUK DARI GRUP', 'Oleh: ' + (payload.actorName ?? 'karyawan'), ...applied].join(NL)); } catch { /* Info untuk owner hanya pelengkap. */ }
}
