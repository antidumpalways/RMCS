// Saat laporan shift disimpan, barang yang hitungannya lebih besar dari catatan sistem ikut disamakan: hitungan fisik
// karyawan adalah acuan, dan shift berikutnya harus mulai dari angka itu. Selisihnya ditambahkan (bukan menimpa), supaya
// barang masuk yang disimpan sesudah draf dibuat tidak terhapus.
import { prisma } from '@/lib/prisma';
import type { RecapStockRaise } from './recap';

export async function applyStockRaises(raises: RecapStockRaise[], actorName: string): Promise<string[]> {
  const applied: string[] = [];
  for (const raise of raises) {
    const delta = raise.to - raise.from;
    if (!Number.isSafeInteger(raise.productId) || !Number.isSafeInteger(delta) || delta < 1 || delta > 1_000_000) continue;
    const product = await prisma.$transaction(async tx => {
      const row = await tx.product.update({ where: { id: raise.productId }, data: { stock: { increment: delta } }, select: { stock: true, costPrice: true } });
      await tx.inventoryMovement.create({ data: { productId: raise.productId, type: 'ADJUST', qty: delta, costAtTime: row.costPrice,
        note: `Laporan shift ${actorName}: hitungan lebih besar dari catatan`, userId: null } });
      return row;
    });
    applied.push(`${raise.label}: ${raise.from} → ${product.stock} (+${delta})`);
  }
  return applied;
}
