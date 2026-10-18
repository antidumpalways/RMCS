'use server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { actionRequiresOwner, isAssistantAction, formatIDR } from '@/lib/assistant-draft';
import {
  addDebtPayment, addStock, adjustStock, applyStockOpname, bulkUpdatePrices,
  closeShift, createDebt, deleteDebt, deleteProduct, deleteStockOpname,
  markStockOpnameReviewed, recordBiayaAdmin, recordExpense, recordStockOpname,
} from '@/lib/actions';

function priceValue(value: unknown): bigint {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  } else if (typeof value === 'string' && /^\d{1,13}$/.test(value)) {
    return BigInt(value);
  }
  throw new Error('Nominal tidak valid.');
}

function positiveId(value: unknown): number {
  if (Number.isSafeInteger(value) && (value as number) > 0) return value as number;
  throw new Error('Referensi data tidak valid. Minta asisten menyiapkan ulang.');
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

async function deleteCatalogProduct(payload: Record<string, unknown>) {
  const id = positiveId(payload.productId);
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!product) throw new Error('Barang tidak ditemukan di katalog.');
  const [sales, moves] = await Promise.all([
    prisma.saleItem.count({ where: { productId: id } }),
    prisma.inventoryMovement.count({ where: { productId: id } }),
  ]);
  if (sales > 0 || moves > 0) {
    throw new Error(`Barang “${product.name}” punya riwayat. Gunakan koreksi stok, bukan menghapus.`);
  }
  await deleteProduct(id);
  return { ok: true as const, message: `Barang “${product.name}” dihapus dari katalog.` };
}

async function bulkPrice(payload: Record<string, unknown>) {
  const margin = payload.marginPercent;
  if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0 || margin > 1000) {
    throw new Error('Margin harus antara 0 dan 1000%.');
  }
  const scope = payload.scope;
  if (scope !== 'all' && scope !== 'category' && scope !== 'subcategory') throw new Error('Cakupan harga tidak valid.');
  let categoryId: number | undefined;
  let subcategoryId: number | undefined;
  if (scope === 'category') {
    categoryId = positiveId(payload.categoryId);
    if (!await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } })) throw new Error('Kategori tidak ditemukan.');
  }
  if (scope === 'subcategory') {
    subcategoryId = positiveId(payload.subcategoryId);
    if (!await prisma.subcategory.findUnique({ where: { id: subcategoryId }, select: { id: true } })) throw new Error('Subkategori tidak ditemukan.');
  }
  const result = await bulkUpdatePrices({ scope, categoryId, subcategoryId, marginPercent: margin });
  return { ok: true as const, message: `Harga ${result?.updated ?? 0} barang diperbarui (margin ${margin}%).` };
}

async function stockIn(payload: Record<string, unknown>) {
  const productId = positiveId(payload.productId);
  const qty = payload.qty;
  if (!Number.isSafeInteger(qty) || (qty as number) <= 0 || (qty as number) > 1_000_000) throw new Error('Jumlah barang masuk tidak valid.');
  const costPerUnit = priceValue(payload.costPerUnit);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
  if (!product) throw new Error('Barang tidak ditemukan.');
  await addStock({
    productId, qty: qty as number, costPerUnit: costPerUnit.toString(),
    supplier: optionalText(payload.supplier, 80),
    note: optionalText(payload.note, 200) ?? 'Barang masuk (via asisten)',
  });
  return { ok: true as const, message: `${qty} ${product.name} masuk; modal jadi ${formatIDR(costPerUnit)}.` };
}

async function stockAdjust(payload: Record<string, unknown>) {
  const productId = positiveId(payload.productId);
  const newStock = payload.newStock;
  if (!Number.isSafeInteger(newStock) || (newStock as number) < 0 || (newStock as number) > 1_000_000) throw new Error('Stok baru tidak valid.');
  const note = optionalText(payload.note, 200);
  if (!note) throw new Error('Catatan koreksi wajib diisi.');
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
  if (!product) throw new Error('Barang tidak ditemukan.');
  await adjustStock({ productId, newStock: newStock as number, note });
  return { ok: true as const, message: `Stok ${product.name} dikoreksi menjadi ${newStock}.` };
}

async function opnameRecord(payload: Record<string, unknown>) {
  const productId = positiveId(payload.productId);
  const physicalStock = payload.physicalStock;
  if (!Number.isSafeInteger(physicalStock) || (physicalStock as number) < 0 || (physicalStock as number) > 1_000_000) throw new Error('Stok fisik tidak valid.');
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
  if (!product) throw new Error('Barang tidak ditemukan.');
  await recordStockOpname({ productId, physicalStock: physicalStock as number, note: optionalText(payload.note, 200) });
  return { ok: true as const, message: `Hitungan fisik ${product.name} (${physicalStock}) dicatat sebagai hasil opname.` };
}

async function opnameAction(payload: Record<string, unknown>, mode: 'apply' | 'review' | 'delete') {
  const opnameId = positiveId(payload.opnameId);
  const opname = await prisma.stockOpname.findUnique({ where: { id: opnameId }, include: { product: { select: { name: true } } } });
  if (!opname) throw new Error('Catatan opname tidak ditemukan.');
  if (mode === 'apply') await applyStockOpname(opnameId);
  else if (mode === 'review') await markStockOpnameReviewed(opnameId);
  else await deleteStockOpname(opnameId);
  const label = mode === 'apply' ? 'diterapkan ke stok' : mode === 'review' ? 'ditandai sudah ditinjau' : 'dihapus';
  return { ok: true as const, message: `Catatan opname ${opname.product.name} ${label}.` };
}

async function debtCreate(payload: Record<string, unknown>) {
  const customer = optionalText(payload.customer, 80);
  if (!customer) throw new Error('Nama pelanggan wajib diisi.');
  const amount = priceValue(payload.amount);
  if (amount <= 0n) throw new Error('Nominal bon harus lebih dari 0.');
  await createDebt({ customer, amount: amount.toString(), description: optionalText(payload.description, 200) });
  return { ok: true as const, message: `Bon ${customer} sebesar ${formatIDR(amount)} dicatat.` };
}

async function debtPay(payload: Record<string, unknown>) {
  const debtId = positiveId(payload.debtId);
  const amount = priceValue(payload.amount);
  if (amount <= 0n) throw new Error('Nominal pembayaran harus lebih dari 0.');
  const debt = await prisma.debt.findUnique({ where: { id: debtId }, select: { customer: true } });
  if (!debt) throw new Error('Bon tidak ditemukan.');
  await addDebtPayment({ debtId, amount: amount.toString(), note: optionalText(payload.note, 200) });
  return { ok: true as const, message: `Pembayaran bon ${debt.customer} sebesar ${formatIDR(amount)} dicatat.` };
}

async function debtDelete(payload: Record<string, unknown>) {
  const debtId = positiveId(payload.debtId);
  const debt = await prisma.debt.findUnique({ where: { id: debtId }, select: { customer: true } });
  if (!debt) throw new Error('Bon tidak ditemukan.');
  await deleteDebt(debtId);
  return { ok: true as const, message: `Bon ${debt.customer} dihapus.` };
}

async function expenseCreate(payload: Record<string, unknown>) {
  const name = optionalText(payload.name, 100);
  if (!name) throw new Error('Nama pengeluaran wajib diisi.');
  const amount = priceValue(payload.amount);
  if (amount <= 0n) throw new Error('Nominal pengeluaran harus lebih dari 0.');
  await recordExpense(name, amount.toString());
  return { ok: true as const, message: `Pengeluaran “${name}” sebesar ${formatIDR(amount)} dicatat.` };
}

async function serviceCreate(payload: Record<string, unknown>) {
  const count = payload.count;
  if (!Number.isSafeInteger(count) || (count as number) <= 0 || (count as number) > 100_000) throw new Error('Jumlah transaksi tidak valid.');
  const profit = priceValue(payload.profit);
  if (profit < 0n) throw new Error('Total biaya admin tidak boleh negatif.');
  await recordBiayaAdmin({ count: count as number, profit: profit.toString() });
  return { ok: true as const, message: `Biaya admin ${count} transaksi sebesar ${formatIDR(profit)} dicatat.` };
}

async function shiftClose(payload: Record<string, unknown>) {
  const result = await closeShift(optionalText(payload.note, 500));
  return { ok: true as const, message: `Shift ditutup: ${result.salesCount} penjualan, ${result.servicesCount} jasa. Serah terima diperbarui.` };
}

// Menerapkan draf aksi asisten. Peran diverifikasi di server (bukan oleh AI).
export async function applyAssistantDraft(input: { action?: unknown; payload?: unknown }) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  if (!input || !isAssistantAction(input.action)) throw new Error('Draf tidak dikenali. Minta asisten menyiapkan ulang.');
  const action = input.action;
  if (actionRequiresOwner(action) && me.role !== 'owner') throw new Error('Aksi ini hanya untuk owner.');
  const payload = payloadRecord(input.payload);

  switch (action) {
    case 'catalog.delete': return deleteCatalogProduct(payload);
    case 'price.bulk': return bulkPrice(payload);
    case 'stock.in': return stockIn(payload);
    case 'stock.adjust': return stockAdjust(payload);
    case 'opname.record': return opnameRecord(payload);
    case 'opname.apply': return opnameAction(payload, 'apply');
    case 'opname.review': return opnameAction(payload, 'review');
    case 'opname.delete': return opnameAction(payload, 'delete');
    case 'debt.create': return debtCreate(payload);
    case 'debt.pay': return debtPay(payload);
    case 'debt.delete': return debtDelete(payload);
    case 'expense.create': return expenseCreate(payload);
    case 'service.create': return serviceCreate(payload);
    case 'shift.close': return shiftClose(payload);
  }
  throw new Error('Aksi tidak dikenali. Minta asisten menyiapkan ulang.');
}
