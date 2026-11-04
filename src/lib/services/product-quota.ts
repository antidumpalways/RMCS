import { prisma } from '@/lib/prisma';

// Kuota voucher hari ini sebagai keterangan. Membaca/menulis bersifat "usahakan saja": bila tabelnya belum ada
// (skema belum tersinkron) atau gagal, semua fitur lain tetap berjalan tanpa kuota.

export async function loadQuotas(ids?: number[]): Promise<Map<number, string>> {
  try {
    const rows = await prisma.productQuota.findMany({ where: ids ? { productId: { in: ids } } : undefined, select: { productId: true, quota: true } });
    return new Map(rows.map(row => [row.productId, row.quota]));
  } catch {
    return new Map();
  }
}

export async function saveQuotas(entries: Array<{ productId: number; quota: string }>): Promise<void> {
  for (const entry of entries) {
    try {
      await prisma.productQuota.upsert({ where: { productId: entry.productId }, create: { productId: entry.productId, quota: entry.quota }, update: { quota: entry.quota } });
    } catch { /* Kuota hanya keterangan; kegagalan menyimpannya tidak boleh menggagalkan perubahan harga/produk. */ }
  }
}
