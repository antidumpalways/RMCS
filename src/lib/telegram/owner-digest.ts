// Ringkasan harian untuk owner. Bagian pembentuk teks murni (tanpa database) agar mudah dites.
import { formatTelegramRupiah } from './core';
import { recapNetAfterExpense, type RecapSummary } from './shift-summary';

export type DigestSoldItem = { name: string; qty: number };
export type DigestLowStock = { name: string; stock: number; minStock: number };

export function formatOwnerDigest(input: {
  dateLabel: string;
  recap: RecapSummary;
  sold: DigestSoldItem[];
  itemMoney: bigint;
  balance: bigint | null;
  lowStock: DigestLowStock[];
  lateEntries: number;
}): string {
  const money = formatTelegramRupiah;
  const nl = String.fromCharCode(10);
  const lines: string[] = ['📊 LAPORAN HARIAN — ' + input.dateLabel];
  if (!input.recap.count && !input.sold.length) {
    lines.push('⚠️ Belum ada rekap shift hari ini.');
  } else {
    lines.push('Rekap shift disimpan: ' + input.recap.count);
    lines.push('Admin jasa: ' + money(input.recap.serviceFee) + ' · Pengeluaran: ' + money(input.recap.expense));
    if (input.recap.sale > 0n) lines.push('Penjualan (rupiah yang ditulis): ' + money(input.recap.sale));
    lines.push('Sisa setelah pengeluaran: ' + money(recapNetAfterExpense(input.recap)));
  }
  if (input.sold.length) {
    lines.push('', '📦 Barang terjual:');
    for (const item of input.sold.slice(0, 10)) lines.push('• ' + item.name + ' — ' + item.qty + ' pcs');
    if (input.sold.length > 10) lines.push('…dan ' + (input.sold.length - 10) + ' barang lain.');
    lines.push('Perkiraan uang dari barang (harga katalog): ' + money(input.itemMoney));
  }
  if (input.lateEntries) lines.push('', '➕ Susulan dicatat: ' + input.lateEntries);
  if (input.balance !== null) lines.push('', '💰 Saldo sekarang: ' + money(input.balance));
  if (input.lowStock.length) {
    lines.push('', '⚠️ Stok menipis (' + input.lowStock.length + '):');
    for (const item of input.lowStock.slice(0, 12)) lines.push('• ' + item.name + ': ' + item.stock + ' (minimum ' + item.minStock + ')');
    if (input.lowStock.length > 12) lines.push('…dan ' + (input.lowStock.length - 12) + ' barang lain.');
  }
  return lines.join(nl);
}
