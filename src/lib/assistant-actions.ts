'use server';

import { prisma } from '@/lib/prisma';
import { saveQuotas } from '@/lib/services/product-quota';
import { getCurrentUser } from '@/lib/auth';
import { isAssistantAction, formatIDR, isMemoryKind, MEMORY_KIND_LABELS } from '@/lib/assistant-draft';
import { applyCatalogDraft, recordCartSale, recordShiftStockCheck, replaceSaleFromChat } from '@/lib/actions';
import { withAssistantAuthorization } from '@/lib/assistant-authorization';
import { setCombinedBalance } from '@/lib/services/combined-balance';
import { Prisma } from '@prisma/client';
import {
  addDebtPayment, addStock, adjustStock, applyCatalogCleanup, applyStockOpname, bulkUpdatePrices,
  closeShift, createCategory, createDebt, createSubcategory, deleteCategory, deleteDebt,
  deleteProduct, deleteStockOpname, deleteSubcategory, markStockOpnameReviewed, recordBiayaAdmin,
  recordExpense, recordSaleReturn, recordStockOpname, renameCategory, renameSubcategory,
} from '@/lib/actions';
import type { CatalogCleanupInput } from '@/lib/actions';

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

async function catalogUpdate(payload: Record<string, unknown>) {
  const id = positiveId(payload.productId);
  const current = await prisma.product.findUnique({ where: { id }, select: { name: true, categoryId: true, subcategoryId: true, sku: true, provider: true, validity: true, minStock: true } });
  if (!current) throw new Error('Barang tidak ditemukan di katalog.');
  const name = payload.name === undefined ? current.name : optionalText(payload.name, 180);
  if (!name) throw new Error('Nama barang baru tidak valid.');
  const categoryId = payload.categoryId === undefined ? current.categoryId : positiveId(payload.categoryId);
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) throw new Error('Kategori tidak ditemukan.');
  const subcategoryId = payload.subcategoryId === undefined ? current.subcategoryId : payload.subcategoryId === null ? null : positiveId(payload.subcategoryId);
  if (subcategoryId !== null && !await prisma.subcategory.findFirst({ where: { id: subcategoryId, categoryId }, select: { id: true } })) throw new Error('Subkategori tidak sesuai dengan kategori.');
  const sku = payload.sku === undefined ? current.sku : optionalText(payload.sku, 80) ?? null;
  const duplicate = await prisma.product.findFirst({ where: { id: { not: id }, categoryId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
  if (duplicate) throw new Error(`Barang “${name}” sudah ada di kategori tersebut.`);
  await prisma.product.update({ where: { id }, data: {
    name, categoryId, subcategoryId, sku,
    ...(payload.provider === undefined ? {} : { provider: optionalText(payload.provider, 80) ?? null }),
    ...(payload.validity === undefined ? {} : { validity: optionalText(payload.validity, 80) ?? null }),
    ...(payload.minStock === undefined ? {} : { minStock: Number.isSafeInteger(payload.minStock) && (payload.minStock as number) >= 0 && (payload.minStock as number) <= 1_000_000 ? payload.minStock as number : (() => { throw new Error('Batas stok minimum tidak valid.'); })() }),
  } });
  return { ok: true as const, message: `Informasi barang “${current.name}” diperbarui.` };
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
  const actualCash = payload.actualCash === undefined || payload.actualCash === null ? null : Number(payload.actualCash);
  if (actualCash !== null && (!Number.isSafeInteger(actualCash) || actualCash < 0)) throw new Error('Kas fisik tidak valid.');
  const result = await closeShift({ note: optionalText(payload.note, 500), actualCash });
  const cash = result.cashDifference === null
    ? `Kas seharusnya ${formatIDR(BigInt(result.expectedCash))}.`
    : `Kas seharusnya ${formatIDR(BigInt(result.expectedCash))}, fisik ${formatIDR(BigInt(result.actualCash ?? 0))}, selisih ${formatIDR(BigInt(result.cashDifference))}.`;
  return { ok: true as const, message: `Shift ditutup: ${result.salesCount} penjualan, ${result.servicesCount} jasa. ${cash} Serah terima diperbarui.` };
}

async function saleReturn(payload: Record<string, unknown>) {
  const saleId = positiveId(payload.saleId);
  const rawItems = payload.items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
    throw new Error('Tidak ada barang retur yang valid.');
  }
  const items = rawItems.map((raw) => {
    const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const productId = positiveId(entry.productId);
    const qty = entry.qty;
    if (!Number.isSafeInteger(qty) || (qty as number) <= 0 || (qty as number) > 1_000_000) {
      throw new Error('Jumlah barang retur tidak valid.');
    }
    return { productId, qty: qty as number };
  });
  const result = await recordSaleReturn({ saleId, items, reason: optionalText(payload.reason, 200) });
  return { ok: true as const, message: `Retur penjualan #${saleId} dicatat. Dana kembali ${formatIDR(-result.refund)}; stok barang diretur bertambah.` };
}

async function catalogCleanup(payload: Record<string, unknown>) {
  const operations = payload.operations;
  if (!Array.isArray(operations) || operations.length < 1) throw new Error('Tidak ada perbaikan untuk diterapkan.');
  const result = await applyCatalogCleanup(operations as CatalogCleanupInput[]);
  const extra = result.skipped ? ` ${result.skipped} barang dilewati karena sudah berubah sejak draf dibuat.` : '';
  return { ok: true as const, message: `Rapikan katalog: ${result.updated} barang diperbarui.${extra}` };
}

async function categoryCreate(payload: Record<string, unknown>) {
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama kategori wajib diisi.');
  if (await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) {
    throw new Error(`Kategori “${name}” sudah ada.`);
  }
  await createCategory(name);
  return { ok: true as const, message: `Kategori “${name}” ditambahkan.` };
}

async function categoryRename(payload: Record<string, unknown>) {
  const id = positiveId(payload.categoryId);
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama kategori baru wajib diisi.');
  const category = await prisma.category.findUnique({ where: { id }, select: { name: true } });
  if (!category) throw new Error('Kategori tidak ditemukan.');
  if (await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } }, select: { id: true } })) {
    throw new Error(`Kategori “${name}” sudah ada.`);
  }
  await renameCategory(id, name);
  return { ok: true as const, message: `Kategori “${category.name}” diubah menjadi “${name}”.` };
}

async function locationCreate(payload: Record<string, unknown>) {
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama lokasi wajib diisi.');
  if (await prisma.location.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) {
    throw new Error(`Lokasi “${name}” sudah ada.`);
  }
  const last = await prisma.location.aggregate({ _max: { sortOrder: true } });
  await prisma.location.create({ data: { name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  return { ok: true as const, message: `Lokasi “${name}” ditambahkan.` };
}

async function locationRename(payload: Record<string, unknown>) {
  const id = positiveId(payload.locationId);
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama lokasi baru wajib diisi.');
  const location = await prisma.location.findUnique({ where: { id }, select: { name: true } });
  if (!location) throw new Error('Lokasi tidak ditemukan.');
  if (await prisma.location.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } }, select: { id: true } })) {
    throw new Error(`Lokasi “${name}” sudah ada.`);
  }
  await prisma.location.update({ where: { id }, data: { name } });
  return { ok: true as const, message: `Lokasi “${location.name}” diubah menjadi “${name}”.` };
}

// Daftar paket harian per provider: ubah/ganti banyak paket dan buat paket baru sekaligus, atomik (semua atau tidak sama sekali).
async function providerSync(payload: Record<string, unknown>) {
  const quotaEntries: Array<{ productId: number; quota: string }> = [];
  const updates = Array.isArray(payload.updates) ? payload.updates as Array<Record<string, unknown>> : [];
  const creates = Array.isArray(payload.creates) ? payload.creates as Array<Record<string, unknown>> : [];
  const zeroIds = Array.isArray(payload.zeroIds) ? (payload.zeroIds as unknown[]).filter((id): id is number => Number.isSafeInteger(id)) : [];
  const retireIds = Array.isArray(payload.retireIds) ? (payload.retireIds as unknown[]).filter((id): id is number => Number.isSafeInteger(id)) : [];
  let removed = 0, deactivated = 0;
  if (updates.length + creates.length + zeroIds.length + retireIds.length > 80) throw new Error('Daftar terlalu panjang (maksimal 60 paket sekali jalan).');
  const money = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{1,13}$/.test(value)) throw new Error('Nominal paket tidak valid.');
    return BigInt(value);
  };
  await prisma.$transaction(async tx => {
    for (const item of updates) {
      const id = positiveId(item.id);
      const current = await tx.product.findUnique({ where: { id }, select: { id: true, categoryId: true, stock: true, costPrice: true } });
      if (!current) throw new Error('Salah satu barang tidak ditemukan di katalog.');
      const name = optionalText(item.name, 180);
      if (!name) throw new Error('Nama paket tidak valid.');
      if (await tx.product.findFirst({ where: { id: { not: id }, categoryId: current.categoryId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) {
        throw new Error(`Barang “${name}” sudah ada di kategori tersebut.`);
      }
      await tx.product.update({ where: { id }, data: { name, validity: optionalText(item.validity, 80) ?? null, sellPrice: money(item.sellPrice), costPrice: money(item.costPrice) } });
      const quota = optionalText(item.quota, 40);
      if (quota) quotaEntries.push({ productId: id, quota });
      // Daftar katalog umum boleh menimpa stok (jumlah absolut), tercatat sebagai pergerakan stok.
      if (Number.isSafeInteger(item.stock) && (item.stock as number) >= 0 && (item.stock as number) <= 1_000_000 && item.stock !== current.stock) {
        await tx.product.update({ where: { id }, data: { stock: item.stock as number } });
        await tx.inventoryMovement.create({ data: { productId: id, type: 'OWNER_CATALOG_SYNC', qty: (item.stock as number) - current.stock, costAtTime: current.costPrice, note: 'Daftar katalog dari owner', userId: null } });
      }
    }
    for (const item of creates) {
      const categoryId = positiveId(item.categoryId);
      if (!await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } })) throw new Error('Kategori paket baru tidak ditemukan.');
      const name = optionalText(item.name, 180);
      if (!name) throw new Error('Nama paket baru tidak valid.');
      if (await tx.product.findFirst({ where: { categoryId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) throw new Error(`Barang “${name}” sudah ada di kategori tersebut.`);
      const stock = Number.isSafeInteger(item.stock) && (item.stock as number) >= 0 && (item.stock as number) <= 1_000_000 ? item.stock as number : 0;
      const subcategoryId = item.subcategoryId === null || item.subcategoryId === undefined ? null : positiveId(item.subcategoryId);
      const costPrice = money(item.costPrice), sellPrice = money(item.sellPrice);
      const product = await tx.product.create({ data: { name, categoryId, subcategoryId, provider: optionalText(item.provider, 80) ?? null, validity: optionalText(item.validity, 80) ?? null,
        costPrice, sellPrice, stock, minStock: 3 } });
      if (stock > 0) await tx.inventoryMovement.create({ data: { productId: product.id, type: 'IN', qty: stock, costAtTime: costPrice, note: 'Stok awal daftar paket harian', userId: null } });
      const quota = optionalText(item.quota, 40);
      if (quota) quotaEntries.push({ productId: product.id, quota });
    }
    // Produk lama yang digantikan daftar baru: hapus bila tidak punya penjualan/rekap/opname; kalau punya, nonaktifkan (stok 0, nama diberi tanda, lepas dari masa aktif).
    for (const id of retireIds) {
      const old = await tx.product.findUnique({ where: { id }, select: { id: true, name: true, stock: true, costPrice: true, categoryId: true,
        _count: { select: { saleItems: true, telegramInventoryPostings: true, stockOpnames: true } } } });
      if (!old) continue;
      if (old._count.saleItems === 0 && old._count.telegramInventoryPostings === 0 && old._count.stockOpnames === 0) {
        await tx.product.delete({ where: { id } });
        removed++;
        continue;
      }
      if (old.stock > 0) await tx.inventoryMovement.create({ data: { productId: id, type: 'OWNER_PROVIDER_SYNC', qty: -old.stock, costAtTime: old.costPrice, note: 'Digantikan daftar paket baru', userId: null } });
      let inactiveName = old.name.endsWith(' (nonaktif)') ? old.name : `${old.name} (nonaktif)`;
      if (await tx.product.findFirst({ where: { id: { not: id }, categoryId: old.categoryId, name: { equals: inactiveName, mode: 'insensitive' } }, select: { id: true } })) inactiveName = `${inactiveName} #${id}`;
      await tx.product.update({ where: { id }, data: { stock: 0, validity: null, name: inactiveName.slice(0, 180) } });
      deactivated++;
    }
    for (const id of zeroIds) {
      const product = await tx.product.findUnique({ where: { id }, select: { id: true, stock: true, costPrice: true } });
      if (!product || product.stock <= 0) continue;
      await tx.product.update({ where: { id }, data: { stock: 0 } });
      await tx.inventoryMovement.create({ data: { productId: id, type: 'OWNER_PROVIDER_SYNC', qty: -product.stock, costAtTime: product.costPrice, note: 'Tidak ada di daftar paket harian', userId: null } });
    }
  }, { isolationLevel: 'Serializable', timeout: 20_000 });
  // Kuota hanya keterangan: disimpan setelah perubahan utama berhasil, dan tidak boleh menggagalkannya.
  await saveQuotas(quotaEntries);
  return { ok: true as const, message: `${updates.length} barang diperbarui, ${creates.length} barang baru${removed ? `, ${removed} produk lama dihapus` : ''}${deactivated ? `, ${deactivated} produk lama dinonaktifkan` : ''}.` };
}

async function categoryDelete(payload: Record<string, unknown>) {
  const id = positiveId(payload.categoryId);
  const category = await prisma.category.findUnique({ where: { id }, select: { name: true } });
  if (!category) throw new Error('Kategori tidak ditemukan.');
  const products = await prisma.product.count({ where: { categoryId: id } });
  if (products > 0) throw new Error(`Kategori “${category.name}” masih dipakai ${products} barang. Pindahkan atau hapus barangnya dulu.`);
  await deleteCategory(id);
  return { ok: true as const, message: `Kategori “${category.name}” dihapus.` };
}

async function subcategoryCreate(payload: Record<string, unknown>) {
  const categoryId = positiveId(payload.categoryId);
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama subkategori wajib diisi.');
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
  if (!category) throw new Error('Kategori tidak ditemukan.');
  if (await prisma.subcategory.findFirst({ where: { categoryId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) {
    throw new Error(`Subkategori “${name}” sudah ada di kategori ${category.name}.`);
  }
  await createSubcategory(categoryId, name);
  return { ok: true as const, message: `Subkategori “${name}” ditambahkan ke ${category.name}.` };
}

async function subcategoryRename(payload: Record<string, unknown>) {
  const id = positiveId(payload.subcategoryId);
  const name = optionalText(payload.name, 60);
  if (!name) throw new Error('Nama subkategori baru wajib diisi.');
  const subcategory = await prisma.subcategory.findUnique({ where: { id }, select: { name: true, category: { select: { name: true } } } });
  if (!subcategory) throw new Error('Subkategori tidak ditemukan.');
  await renameSubcategory(id, name);
  return { ok: true as const, message: `Subkategori “${subcategory.name}” (${subcategory.category.name}) diubah menjadi “${name}”.` };
}

async function subcategoryDelete(payload: Record<string, unknown>) {
  const id = positiveId(payload.subcategoryId);
  const subcategory = await prisma.subcategory.findUnique({ where: { id }, select: { name: true } });
  if (!subcategory) throw new Error('Subkategori tidak ditemukan.');
  await deleteSubcategory(id);
  return { ok: true as const, message: `Subkategori “${subcategory.name}” dihapus.` };
}

async function updateBalance(payload: Record<string, unknown>, userId: number, sourceDraftId?: string) {
  const newBalance = priceValue(payload.actualBalance);
  const expectedRaw = payload.expectedBalance;
  if (typeof expectedRaw !== 'string' || !/^-?\d{1,16}$/.test(expectedRaw)) throw new Error('Saldo pembanding pada draf tidak valid.');
  const expectedBalance = BigInt(expectedRaw);
  const note = optionalText(payload.note, 240) ?? null;
  const result = await prisma.$transaction(tx => setCombinedBalance(tx, {
    targetBalance: newBalance, expectedBalance, createdById: userId, sourceDraftId, note,
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ok: true as const, message: 'Saldo gabungan kas + elektronik diperbarui dari ' + formatIDR(result.previousBalance) + ' menjadi ' + formatIDR(result.newBalance) + '. Selisih ' + formatIDR(result.delta) + ' dicatat di riwayat penyesuaian.' };
}
async function memorySave(payload: Record<string, unknown>, userId: number) {
  if (!isMemoryKind(payload.kind)) throw new Error('Jenis memori tidak dikenali.');
  const content = optionalText(payload.content, 300);
  if (!content) throw new Error('Isi memori wajib diisi.');
  const term = optionalText(payload.term, 80);
  if (payload.kind === 'SYNONYM' && !term) throw new Error('Istilah yang dipakai wajib diisi untuk sinonim.');
  await prisma.assistantMemory.create({ data: { kind: payload.kind, term: term ?? null, content, createdById: userId } });
  return { ok: true as const, message: `Diingat — ${MEMORY_KIND_LABELS[payload.kind]}: ${term ? `“${term}” = ` : ''}${content}` };
}

async function memoryForget(payload: Record<string, unknown>) {
  const memoryId = positiveId(payload.memoryId);
  const memory = await prisma.assistantMemory.findUnique({ where: { id: memoryId }, select: { term: true, content: true } });
  if (!memory) throw new Error('Memori tidak ditemukan. Minta asisten menampilkan daftar memori.');
  await prisma.assistantMemory.delete({ where: { id: memoryId } });
  return { ok: true as const, message: `Memori dihapus: ${memory.term ? `“${memory.term}” = ` : ''}${memory.content}` };
}

// Menerapkan draf aksi asisten. Peran diverifikasi di server (bukan oleh AI).
export async function applyAssistantDraft(input: { action?: unknown; payload?: unknown; sourceDraftId?: string }) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  if (!input || !isAssistantAction(input.action)) throw new Error('Draf tidak dikenali. Minta asisten menyiapkan ulang.');
  const action = input.action;
  if (action === 'balance.update' && me.role !== 'owner') throw new Error('Pembaruan saldo hanya dapat dilakukan owner.');
  const payload = payloadRecord(input.payload);

  return withAssistantAuthorization(async () => {
    switch (action) {
      case 'catalog.update': return catalogUpdate(payload);
      case 'catalog.delete': return deleteCatalogProduct(payload);
      case 'catalog.cleanup': return catalogCleanup(payload);
      case 'category.create': return categoryCreate(payload);
      case 'category.rename': return categoryRename(payload);
      case 'category.delete': return categoryDelete(payload);
      case 'subcategory.create': return subcategoryCreate(payload);
      case 'subcategory.rename': return subcategoryRename(payload);
      case 'subcategory.delete': return subcategoryDelete(payload);
      case 'location.create': return locationCreate(payload);
      case 'location.rename': return locationRename(payload);
      case 'provider.sync': return providerSync(payload);
      case 'provider.replace': return providerSync(payload);
      case 'catalog.sync': return providerSync(payload);
      case 'catalog.replace': return providerSync(payload);
      case 'sale.create': {
        const result = await recordCartSale(payload.items as { productId: number; qty: number }[], payload.expectedPrices as { productId: number; sellPrice: string }[]);
        if ('error' in result) throw new Error(result.error);
        return { ok: true as const, message: `Penjualan #${result.saleId} berhasil dicatat.`, };
      }
      case 'sale.edit': {
        const result = await replaceSaleFromChat(payload as unknown as Parameters<typeof replaceSaleFromChat>[0]);
        return { ok: true as const, message: `Penjualan #${result.saleId} berhasil dikoreksi.` };
      }
      case 'sale.return': return saleReturn(payload);
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
      case 'balance.update': return updateBalance(payload, me.id, input.sourceDraftId);
      case 'memory.save': return memorySave(payload, me.id);
      case 'memory.forget': return memoryForget(payload);
      default: throw new Error('Aksi tidak dikenali. Minta asisten menyiapkan ulang.');
    }
  });
}

// Katalog memakai aksi server tersendiri; izin assistant hanya diberikan saat
// aksi ini dipanggil dari tombol konfirmasi pada kartu draf.
export async function applyAssistantCatalogDraft(input: Parameters<typeof applyCatalogDraft>[0]) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  return withAssistantAuthorization(() => applyCatalogDraft(input));
}

export async function applyAssistantSaleCorrection(input: Parameters<typeof replaceSaleFromChat>[0]) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  return withAssistantAuthorization(() => replaceSaleFromChat(input));
}

export async function applyAssistantStockCheck(input: Parameters<typeof recordShiftStockCheck>[0]) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  return withAssistantAuthorization(() => recordShiftStockCheck(input));
}

