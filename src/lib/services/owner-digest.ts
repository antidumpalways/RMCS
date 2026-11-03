import { prisma } from '@/lib/prisma';
import { combinedBalanceAt } from '@/lib/services/combined-balance';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { configuredTelegramOwners } from '@/lib/telegram/identity';
import { formatOwnerDigest } from '@/lib/telegram/owner-digest';
import { jakartaDateKey, sumRecapReports } from '@/lib/telegram/shift-summary';

// Awal hari kalender WIB (UTC+7) dari kunci tanggal YYYY-MM-DD.
function jakartaDayStart(dateKey: string): Date {
  return new Date(dateKey + 'T00:00:00+07:00');
}

async function ownerChatIds(): Promise<string[]> {
  const linked = await prisma.user.findMany({ where: { role: 'owner', active: true, telegramUserId: { not: null } }, select: { telegramUserId: true } });
  return [...new Set([...configuredTelegramOwners(), ...linked.flatMap(owner => owner.telegramUserId === null ? [] : [owner.telegramUserId.toString()])])];
}

export async function buildOwnerDigest(now = new Date()): Promise<string> {
  const dateKey = jakartaDateKey(now);
  const from = jakartaDayStart(dateKey);
  const reports = await prisma.telegramShiftReport.findMany({ where: { confirmedAt: { gte: from } }, select: { confirmedAt: true, shiftLabel: true, payload: true } });
  const recap = sumRecapReports(reports);
  const postings = await prisma.telegramInventoryPosting.findMany({ where: { createdAt: { gte: from } },
    select: { appliedQty: true, product: { select: { id: true, name: true, sellPrice: true } } } });
  const byProduct = new Map<number, { name: string; qty: number; price: bigint }>();
  for (const posting of postings) {
    const current = byProduct.get(posting.product.id) ?? { name: posting.product.name, qty: 0, price: posting.product.sellPrice };
    current.qty += posting.appliedQty;
    byProduct.set(posting.product.id, current);
  }
  const sold = [...byProduct.values()].filter(item => item.qty > 0).sort((a, b) => b.qty - a.qty);
  const itemMoney = sold.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
  const lateEntries = await prisma.telegramOwnerReviewTask.count({ where: { kind: 'LATE_ENTRY', createdAt: { gte: from } } });
  let balance: bigint | null = null;
  try { balance = await combinedBalanceAt(now); } catch { balance = null; }
  const products = await prisma.product.findMany({ select: { name: true, stock: true, minStock: true } });
  const lowStock = products.filter(product => product.stock <= product.minStock).sort((a, b) => a.stock - b.stock);
  return formatOwnerDigest({ dateLabel: dateKey, recap, sold, itemMoney, balance, lowStock, lateEntries });
}

export async function sendOwnerDigest(now = new Date()) {
  const text = await buildOwnerDigest(now);
  const owners = await ownerChatIds();
  let sent = 0;
  for (const ownerId of owners) {
    try { await sendTelegramMessage(BigInt(ownerId), text); sent++; } catch { /* Pengiriman ke satu owner tidak boleh menggagalkan yang lain. */ }
  }
  return { owners: owners.length, sent };
}
