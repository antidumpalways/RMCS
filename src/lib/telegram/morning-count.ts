// "Update stok" pagi: hitungan karyawan (stok + modal/uang awal) menjadi acuan baru, lalu shift dibuka dari angka itu.
import { prisma } from '@/lib/prisma';
import { combinedBalanceAt, setCombinedBalance } from '@/lib/services/combined-balance';
import { resolveCountItems } from './count-extract';
import { productLabel, type CountMessage } from './group-count';

export type MorningResult = {
  changes: string[];
  unchanged: number;
  unmatched: string[];
  notes: string[];
  balance: { before: bigint; after: bigint; changed: boolean } | null;
};

export async function applyMorningCount(count: CountMessage, actorName: string): Promise<MorningResult> {
  const { counts, catalogProducts } = await resolveCountItems(count);
  const nameCount = new Map<string, number>();
  for (const product of catalogProducts) nameCount.set(product.name.toLowerCase(), (nameCount.get(product.name.toLowerCase()) ?? 0) + 1);
  const changes: string[] = [], unmatched: string[] = [], notes: string[] = [], seen = new Set<number>();
  let unchanged = 0;

  for (const { item, product } of counts) {
    if (!product) { unmatched.push(`${item.label} (${item.stock})`); continue; }
    const label = productLabel(product, (nameCount.get(product.name.toLowerCase()) ?? 0) > 1);
    if (seen.has(product.id)) { notes.push(`${label} ditulis lebih dari sekali; yang pertama dipakai.`); continue; }
    seen.add(product.id);
    if (product.stock === item.stock) { unchanged++; continue; }
    const diff = item.stock - product.stock;
    try {
      await prisma.$transaction(async tx => {
        const row = await tx.product.findUnique({ where: { id: product.id }, select: { stock: true, costPrice: true } });
        if (!row || row.stock !== product.stock) throw new Error('STALE');
        await tx.product.update({ where: { id: product.id }, data: { stock: item.stock } });
        await tx.inventoryMovement.create({ data: { productId: product.id, type: 'ADJUST', qty: diff, costAtTime: row.costPrice, note: `Update stok pagi oleh ${actorName}`, userId: null } });
      });
      changes.push(`${label}: ${product.stock} → ${item.stock} (${diff > 0 ? '+' : ''}${diff})`);
    } catch { notes.push(`${label}: stok berubah saat diproses, hitungan pagi tidak diterapkan. Kirim ulang.`); }
  }

  let balance: MorningResult['balance'] = null;
  if (count.total?.amount != null) {
    const target = BigInt(count.total.amount);
    const before = await combinedBalanceAt(new Date());
    if (before !== target) {
      await prisma.$transaction(tx => setCombinedBalance(tx, { targetBalance: target, createdById: null, note: `Modal pagi dari ${actorName} lewat Update stok Telegram` }));
    }
    balance = { before, after: target, changed: before !== target };
  } else if (count.total) notes.push(`Modal “${count.total.raw}” kurang jelas, uang awal memakai catatan sistem. Tulis misalnya Modal: 34.463.000.`);
  if (count.admin) notes.push('Admin diabaikan di pesan pagi; kirim bersama Update stok sore.');
  return { changes, unchanged, unmatched, notes, balance };
}
