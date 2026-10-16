'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { toBigIntSafe } from '@/lib/utils';
import { getCurrentUser } from '@/lib/auth';
import { jakartaTodayBounds, saleSnapshotSignature } from '@/lib/sale-chat';

// ============================================================================
// CATEGORIES
// ============================================================================
export async function createCategory(name: string) {
  if (!name.trim()) return;
  await prisma.category.create({ data: { name: name.trim() } });
  revalidatePath('/inventory');
  revalidatePath('/transaksi');
}

export async function deleteCategory(id: number) {
  // CASCADE subcategory & product (pastikan tak ada history)
  await prisma.category.delete({ where: { id } });
  revalidatePath('/inventory');
}

// ============================================================================
// LOCATIONS - custom (admin CRUD)
// ============================================================================
export async function createLocation(name: string) {
  if (!name.trim()) throw new Error('Nama lokasi wajib diisi');
  // sortOrder = max + 1
  const last = await prisma.location.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = (last?.sortOrder ?? 0) + 1;
  await prisma.location.create({ data: { name: name.trim(), sortOrder } });
  revalidatePath('/pengaturan');
  revalidatePath('/inventory');
  revalidatePath('/harga');
}

export async function deleteLocation(id: number) {
  // SetNull on product.locationId (sudah di schema)
  await prisma.location.delete({ where: { id } });
  revalidatePath('/pengaturan');
  revalidatePath('/inventory');
  revalidatePath('/harga');
}

// ============================================================================
// SUBCATEGORIES
// ============================================================================
export async function createSubcategory(categoryId: number, name: string) {
  if (!name.trim()) return;
  await prisma.subcategory.create({ data: { categoryId, name: name.trim() } });
  revalidatePath('/inventory');
}

export async function deleteSubcategory(id: number) {
  await prisma.subcategory.delete({ where: { id } });
  revalidatePath('/inventory');
}

// ============================================================================
// PRODUCTS
// ============================================================================
export async function createProduct(data: {
  name: string;
  categoryId: number;
  subcategoryId?: number | null;
  provider?: string | null;
  validity?: string | null;
  locationId?: number | null;
  costPrice: number | string;
  sellPrice: number | string;
  stock: number;
  minStock: number;
}) {
  const product = await prisma.product.create({
    data: {
      name: data.name.trim(),
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId ?? null,
      provider: data.provider?.trim() || null,
      validity: data.validity?.trim() || null,
      locationId: data.locationId ?? null,
      costPrice: toBigIntSafe(data.costPrice),
      sellPrice: toBigIntSafe(data.sellPrice),
      stock: data.stock,
      minStock: data.minStock,
    },
  });
  if (data.stock > 0) {
    await prisma.inventoryMovement.create({
      data: {
        productId: product.id,
        type: 'IN',
        qty: data.stock,
        costAtTime: toBigIntSafe(data.costPrice),
        note: 'Stok awal',
      },
    });
  }
  revalidatePath('/inventory');
  revalidatePath('/');
  revalidatePath('/harga');
  return product;
}

export async function updateProduct(
  id: number,
  data: {
    name: string;
    categoryId: number;
    subcategoryId?: number | null;
    provider?: string | null;
    validity?: string | null;
    locationId?: number | null;
    costPrice: number | string;
    sellPrice: number | string;
    minStock: number;
  }
) {
  await prisma.product.update({
    where: { id },
    data: {
      name: data.name.trim(),
      categoryId: data.categoryId,
      subcategoryId: data.subcategoryId ?? null,
      provider: data.provider?.trim() || null,
      validity: data.validity?.trim() || null,
      locationId: data.locationId ?? null,
      costPrice: toBigIntSafe(data.costPrice),
      sellPrice: toBigIntSafe(data.sellPrice),
      minStock: data.minStock,
    },
  });
  revalidatePath('/inventory');
  revalidatePath('/');
  revalidatePath('/harga');
}

// ============================================================================
// ADJUST STOCK - koreksi stok manual (untuk admin/owner)
// Set stok ke nilai absolut, dengan audit trail di InventoryMovement
// ============================================================================
export async function adjustStock(data: {
  productId: number;
  newStock: number;
  note: string;
}) {
  if (data.newStock < 0) throw new Error('Stok tidak boleh negatif');
  if (!data.note.trim()) throw new Error('Catatan koreksi wajib diisi');
  const me = await getCurrentUser();
  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: data.productId } });
    const diff = data.newStock - product.stock;
    if (diff === 0) {
      throw new Error('Stok tidak berubah');
    }
    await tx.product.update({
      where: { id: data.productId },
      data: { stock: data.newStock },
    });
    await tx.inventoryMovement.create({
      data: {
        productId: data.productId,
        type: 'ADJUST',
        qty: diff,
        costAtTime: product.costPrice,
        note: `Koreksi: ${data.note.trim()}`,
        userId: me?.id ?? null,
      },
    });
  });
  revalidatePath('/inventory');
  revalidatePath('/');
  revalidatePath('/harga');
}

export async function deleteProduct(id: number) {
  await prisma.product.delete({ where: { id } });
  revalidatePath('/inventory');
  revalidatePath('/');
}

// ============================================================================
// INVENTORY IN (barang masuk)
// Modal di-update ke harga beli terbaru (cost per unit saat ini)
// ============================================================================
export async function addStock(data: {
  productId: number;
  qty: number;
  costPerUnit: number | string;
  supplier?: string;
  note?: string;
}) {
  if (data.qty <= 0) return;
  const me = await getCurrentUser();
  const costPerUnit = toBigIntSafe(data.costPerUnit);
  if (costPerUnit < 0n) throw new Error('Harga beli tidak boleh negatif');
  await prisma.$transaction(async (tx) => {
    // Update modal ke harga beli terbaru
    await tx.product.update({
      where: { id: data.productId },
      data: {
        stock: { increment: data.qty },
        costPrice: costPerUnit,
      },
    });
    await tx.inventoryMovement.create({
      data: {
        productId: data.productId,
        type: 'IN',
        qty: data.qty,
        costAtTime: costPerUnit,
        supplier: data.supplier?.trim() || null,
        note: data.note || 'Barang masuk',
        userId: me?.id ?? null,
      },
    });
  });
  revalidatePath('/inventory');
  revalidatePath('/');
  revalidatePath('/harga');
}

// ============================================================================
// UPDATE HARGA MASSAL
// Set harga jual baru untuk semua produk dalam kategori/subkategori
// berdasarkan margin % dari modal saat ini
// ============================================================================
export async function bulkUpdatePrices(data: {
  categoryId?: number;
  subcategoryId?: number;
  marginPercent: number;
  scope: 'all' | 'category' | 'subcategory';
}) {
  if (data.marginPercent < 0 || data.marginPercent > 1000) {
    throw new Error('Margin harus 0-1000%');
  }
  const products = await prisma.product.findMany({
    where:
      data.scope === 'subcategory' && data.subcategoryId
        ? { subcategoryId: data.subcategoryId }
        : data.scope === 'category' && data.categoryId
          ? { categoryId: data.categoryId }
          : {},
    select: { id: true, costPrice: true, name: true },
  });
  if (products.length === 0) return { updated: 0 };
  const updates = products.map((p) => {
    // harga jual = modal × (1 + margin/100), rounded to nearest 500
    const raw = Number(p.costPrice) * (1 + data.marginPercent / 100);
    const rounded = Math.ceil(raw / 500) * 500;
    return prisma.product.update({
      where: { id: p.id },
      data: { sellPrice: BigInt(rounded) },
    });
  });
  await prisma.$transaction(updates);
  revalidatePath('/inventory');
  revalidatePath('/harga');
  return { updated: products.length };
}

// ============================================================================
// DEBTS / PIUTANG
// ============================================================================
export async function createDebt(data: {
  customer: string;
  amount: number | string;
  description?: string;
}) {
  if (!data.customer.trim()) throw new Error('Nama customer wajib diisi');
  const amount = toBigIntSafe(data.amount);
  if (amount <= 0n) throw new Error('Nominal harus > 0');
  const me = await getCurrentUser();
  await prisma.debt.create({
    data: {
      customer: data.customer.trim(),
      amount,
      description: data.description?.trim() || null,
      userId: me?.id ?? null,
    },
  });
  revalidatePath('/piutang');
}

export async function addDebtPayment(data: { debtId: number; amount: number | string; note?: string }) {
  const amount = toBigIntSafe(data.amount);
  if (amount <= 0n) throw new Error('Nominal harus > 0');
  const me = await getCurrentUser();
  await prisma.$transaction(async (tx) => {
    const debt = await tx.debt.findUniqueOrThrow({ where: { id: data.debtId } });
    const remaining = debt.amount - debt.paid;
    if (remaining <= 0n) {
      throw new Error('Bon ini sudah lunas.');
    }
    if (amount > remaining) {
      throw new Error(`Pembayaran melebihi sisa bon (sisa ${remaining.toString()}).`);
    }
    const newPaid = debt.paid + amount;
    const newStatus = newPaid >= debt.amount ? 'LUNAS' : 'BELUM';
    // Cegah lost update: hanya update jika paid masih sama seperti saat dibaca.
    const updated = await tx.debt.updateMany({
      where: { id: data.debtId, paid: debt.paid },
      data: { paid: newPaid, status: newStatus },
    });
    if (updated.count !== 1) {
      throw new Error('Sisa bon berubah. Muat ulang halaman lalu coba lagi.');
    }
    await tx.debtPayment.create({
      data: {
        debtId: data.debtId,
        amount,
        note: data.note?.trim() || null,
        userId: me?.id ?? null,
      },
    });
  });
  revalidatePath('/piutang');
  revalidatePath('/');
  revalidatePath('/transaksi');
}

export async function deleteDebt(id: number) {
  await prisma.debt.delete({ where: { id } });
  revalidatePath('/piutang');
}

// ============================================================================
// TUTUP SHIFT (End-of-Shift Report)
// Hitung ringkasan transaksi dari shift yang sedang berjalan & simpan snapshot
// ============================================================================
export async function closeShift(note?: string) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Tidak ada user');
  const shiftName = me.shift;
  if (!shiftName) {
    // user tanpa shift (mis. admin) -> pakai "all" sebagai label
  }
  // Tentukan range waktu shift
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const shiftStart = todayStart;
  const shiftEnd = now;

  const [sales, services, expenses, stockChecks] = await Promise.all([
    prisma.saleTransaction.findMany({
      where: {
        createdAt: { gte: shiftStart, lte: shiftEnd },
        ...(me.id ? { userId: me.id } : {}),
      },
    }),
    prisma.serviceTransaction.findMany({
      where: {
        createdAt: { gte: shiftStart, lte: shiftEnd },
        ...(me.id ? { userId: me.id } : {}),
      },
    }),
    prisma.expense.findMany({
      where: {
        createdAt: { gte: shiftStart, lte: shiftEnd },
        ...(me.id ? { userId: me.id } : {}),
      },
    }),
    prisma.stockOpname.findMany({
      where: {
        userId: me.id,
        createdAt: { gte: shiftStart, lte: shiftEnd },
        note: { in: ['Cek stok buka shift', 'Cek stok tutup shift'] },
      },
      select: { note: true, diff: true, reviewStatus: true },
    }),
  ]);

  const salesRevenue = sales.reduce((a, s) => a + s.totalRevenue, 0n);
  const salesProfit = sales.reduce((a, s) => a + s.totalProfit, 0n);
  const servicesProfit = services.reduce((a, s) => a + s.profit, 0n);
  const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0n);
  const openingStockCount = stockChecks.filter((item) => item.note === 'Cek stok buka shift').length;
  const closingStockCount = stockChecks.filter((item) => item.note === 'Cek stok tutup shift').length;
  const stockDiscrepancyCount = stockChecks.filter((item) => item.diff !== 0 && item.reviewStatus === 'PENDING').length;

  const closure = await prisma.shiftClosure.create({
    data: {
      userId: me.id,
      shift: shiftName || 'all',
      closedAt: now,
      salesCount: sales.length,
      salesRevenue,
      salesProfit,
      servicesCount: services.length,
      servicesProfit,
      expensesTotal,
      openingStockCount,
      closingStockCount,
      stockDiscrepancyCount,
      note: note?.trim() || null,
    },
    select: { id: true },
  });
  revalidatePath('/transaksi');
  revalidatePath('/laporan');
  revalidatePath('/serah-terima');
  return {
    id: closure.id,
    salesCount: sales.length,
    salesRevenue,
    salesProfit,
    servicesCount: services.length,
    servicesProfit,
    expensesTotal,
    openingStockCount,
    closingStockCount,
    stockDiscrepancyCount,
  };
}

// ============================================================================
// STOCK OPNAME
// Catat hasil hitung fisik, sistem hitung selisih
// ============================================================================
export async function recordStockOpname(data: {
  productId: number;
  physicalStock: number;
  note?: string;
}) {
  if (data.physicalStock < 0) throw new Error('Stok fisik tidak boleh negatif');
  const me = await getCurrentUser();
  if (!me || me.role !== 'owner') throw new Error('Hanya owner yang dapat mencatat opname manual.');
  const product = await prisma.product.findUniqueOrThrow({ where: { id: data.productId } });
  const diff = data.physicalStock - product.stock;
  await prisma.stockOpname.create({
    data: {
      productId: data.productId,
      systemStock: product.stock,
      physicalStock: data.physicalStock,
      diff,
      reviewStatus: diff === 0 ? 'MATCHED' : 'PENDING',
      note: data.note?.trim() || null,
      userId: me?.id ?? null,
    },
  });
  revalidatePath('/inventory');
  revalidatePath('/opname');
}

// Employee stock check at the start or end of a shift. Save the physical count
// and its difference for the owner to review; this does not change Product.stock.
export async function recordShiftStockCheck(data: {
  phase: 'buka' | 'tutup';
  counts: { productId: number; physicalStock: number }[];
}) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'karyawan') throw new Error('Menu ini khusus karyawan.');
  if (!data || !['buka', 'tutup'].includes(data.phase)) throw new Error('Waktu cek stok tidak valid.');
  if (!Array.isArray(data.counts) || data.counts.length === 0 || data.counts.length > 500) {
    throw new Error('Isi hasil hitung minimal satu barang.');
  }

  const seen = new Set<number>();
  for (const item of data.counts) {
    if (!Number.isSafeInteger(item?.productId) || item.productId <= 0 || seen.has(item.productId) ||
        !Number.isSafeInteger(item.physicalStock) || item.physicalStock < 0 || item.physicalStock > 1_000_000) {
      throw new Error('Periksa kembali jumlah stok yang diisi.');
    }
    seen.add(item.productId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: data.counts.map((item) => item.productId) } },
      select: { id: true, stock: true },
    });
    if (products.length !== data.counts.length) throw new Error('Ada barang yang sudah tidak tersedia. Muat ulang halaman.');
    const stockById = new Map(products.map((product) => [product.id, product.stock]));
    const entries = data.counts.map((item) => {
      const systemStock = stockById.get(item.productId)!;
      const diff = item.physicalStock - systemStock;
      return {
        productId: item.productId,
        systemStock,
        physicalStock: item.physicalStock,
        diff,
        reviewStatus: diff === 0 ? 'MATCHED' : 'PENDING',
        note: `Cek stok ${data.phase} shift`,
        userId: me.id,
      };
    });
    await tx.stockOpname.createMany({ data: entries });
    return { checkedCount: entries.length, changedCount: entries.filter((entry) => entry.diff !== 0).length };
  });

  revalidatePath('/cek-stok');
  revalidatePath('/opname');
  revalidatePath('/inventory');
  revalidatePath('/');
  return result;
}

export async function applyStockOpname(id: number) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'owner') throw new Error('Hanya owner yang dapat menerapkan hasil opname.');
  await prisma.$transaction(async (tx) => {
    const opname = await tx.stockOpname.findUniqueOrThrow({ where: { id } });
    if (opname.reviewStatus !== 'PENDING' || opname.diff === 0) {
      throw new Error('Catatan ini sudah ditinjau atau tidak memiliki selisih.');
    }
    const productUpdate = await tx.product.updateMany({
      where: { id: opname.productId, stock: opname.systemStock },
      data: { stock: opname.physicalStock },
    });
    if (productUpdate.count !== 1) {
      throw new Error('Stok produk sudah berubah sejak hitungan ini. Tinjau ulang sebelum menerapkan.');
    }
    await tx.stockOpname.update({
      where: { id },
      data: { reviewStatus: 'APPLIED', reviewedAt: new Date(), reviewedByUserId: me.id },
    });
  });
  revalidatePath('/inventory');
  revalidatePath('/opname');
  revalidatePath('/serah-terima');
}

export async function markStockOpnameReviewed(id: number) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'owner') throw new Error('Hanya owner yang dapat meninjau hasil opname.');
  const result = await prisma.stockOpname.updateMany({
    where: { id, reviewStatus: 'PENDING', diff: { not: 0 } },
    data: { reviewStatus: 'REVIEWED', reviewedAt: new Date(), reviewedByUserId: me.id },
  });
  if (result.count !== 1) throw new Error('Catatan ini sudah ditinjau atau tidak memiliki selisih.');
  revalidatePath('/opname');
  revalidatePath('/serah-terima');
}

export async function deleteStockOpname(id: number) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'owner') throw new Error('Hanya owner yang dapat menghapus catatan opname.');
  await prisma.stockOpname.delete({ where: { id } });
  revalidatePath('/opname');
}

// ============================================================================
// SALES (barang terjual)
// Stok berkurang, omzet & profit bertambah otomatis
// ============================================================================
export async function recordCartSale(items: { productId: number; qty: number }[], expectedPrices?: { productId: number; sellPrice: string }[]) {
  const me = await getCurrentUser();
  if (!me) return { error: 'Sesi berakhir. Silakan masuk kembali.' };
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return { error: 'Pilih 1–100 jenis barang untuk dicatat.' };
  }
  const quantities = new Map<number, number>();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.productId) || item.productId <= 0 ||
        !Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > 1_000_000) {
      return { error: 'Jumlah barang harus berupa angka bulat yang valid.' };
    }
    const qty = (quantities.get(item.productId) ?? 0) + item.qty;
    if (qty > 1_000_000) return { error: 'Jumlah barang terlalu besar.' };
    quantities.set(item.productId, qty);
  }
  const expected = new Map<number, string>();
  if (expectedPrices) {
    if (!Array.isArray(expectedPrices) || expectedPrices.length !== quantities.size || expectedPrices.some((item) =>
      !item || !Number.isSafeInteger(item.productId) || item.productId <= 0 ||
      typeof item.sellPrice !== 'string' || !/^\d+$/.test(item.sellPrice))) {
      return { error: 'Draf harga tidak valid. Minta asisten menyiapkan ulang penjualan.' };
    }
    for (const item of expectedPrices) expected.set(item.productId, item.sellPrice);
    if ([...quantities.keys()].some((id) => !expected.has(id))) return { error: 'Draf harga tidak lengkap.' };
  }
  class CartError extends Error {}
  try {
    const sale = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: [...quantities.keys()] } } });
      if (products.length !== quantities.size) throw new CartError('Ada barang yang tidak tersedia lagi. Perbarui daftar barang.');
      // Keep a consistent lock order for baskets containing the same products.
      products.sort((a, b) => a.id - b.id);
      const lines = [];
      let totalRevenue = 0n;
      let totalProfit = 0n;
      for (const p of products) {
        const qty = quantities.get(p.id)!;
        if (expectedPrices && expected.get(p.id) !== p.sellPrice.toString()) {
          throw new CartError(`Harga ${p.name} berubah. Minta asisten menyiapkan draf baru.`);
        }
        const updated = await tx.product.updateMany({
          where: { id: p.id, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });
        if (updated.count !== 1) throw new CartError(`Stok ${p.name} tidak cukup. Kurangi jumlah atau perbarui daftar barang.`);
        const revenue = p.sellPrice * BigInt(qty);
        const profit = (p.sellPrice - p.costPrice) * BigInt(qty);
        totalRevenue += revenue;
        totalProfit += profit;
        lines.push({ productId: p.id, qty, priceAtSale: p.sellPrice, costAtSale: p.costPrice, revenue, profit });
      }
      return tx.saleTransaction.create({
        data: { userId: me.id, totalRevenue, totalProfit, items: { create: lines } },
        select: { id: true },
      });
    });
    for (const path of ['/', '/transaksi', '/inventory', '/harga', '/laporan']) revalidatePath(path);
    return { success: true as const, saleId: sale.id };
  } catch (error) {
    if (error instanceof CartError) return { error: error.message };
    console.error('Gagal mencatat keranjang penjualan', error);
    return { error: 'Penjualan belum tersimpan. Periksa koneksi lalu coba lagi.' };
  }
}

export async function replaceSaleFromChat(input: {
  saleId: number;
  expectedSignature: string;
  items: { productId: number; qty: number; expectedPrice: string }[];
}) {
  const me = await getCurrentUser();
  if (!me) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  if (!input || !Number.isSafeInteger(input.saleId) || input.saleId <= 0 ||
      typeof input.expectedSignature !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSignature) ||
      !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new Error('Draf koreksi tidak valid. Minta asisten menyiapkan ulang.');
  }
  const requested = new Map<number, { qty: number; expectedPrice: string }>();
  for (const item of input.items) {
    if (!item || !Number.isSafeInteger(item.productId) || item.productId <= 0 ||
        !Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > 1_000_000 ||
        typeof item.expectedPrice !== 'string' || !/^\d+$/.test(item.expectedPrice) || requested.has(item.productId)) {
      throw new Error('Barang atau jumlah dalam draf koreksi tidak valid.');
    }
    requested.set(item.productId, { qty: item.qty, expectedPrice: item.expectedPrice });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Kunci header agar dua koreksi atas penjualan yang sama tidak saling menimpa.
    await tx.$queryRaw`SELECT "id" FROM "SaleTransaction" WHERE "id" = ${input.saleId} FOR UPDATE`;
    const sale = await tx.saleTransaction.findUnique({ where: { id: input.saleId }, include: { items: true } });
    if (!sale) throw new Error('Penjualan tidak ditemukan.');
    if (me.role !== 'owner' && sale.userId !== me.id) throw new Error('Anda hanya bisa mengoreksi penjualan sendiri.');
    const { start, end } = jakartaTodayBounds();
    if (sale.createdAt < start || sale.createdAt >= end) throw new Error('Chat hanya bisa mengoreksi penjualan hari ini.');
    if (sale.userId && await tx.shiftClosure.count({ where: { userId: sale.userId, closedAt: { gte: sale.createdAt } } })) {
      throw new Error('Shift untuk penjualan ini sudah ditutup. Hubungi owner untuk koreksi laporan.');
    }
    if (saleSnapshotSignature(sale) !== input.expectedSignature) {
      throw new Error('Penjualan berubah sejak draf dibuat. Minta asisten menyiapkan ulang.');
    }

    const products = await tx.product.findMany({ where: { id: { in: [...requested.keys()] } }, orderBy: { id: 'asc' } });
    if (products.length !== requested.size) throw new Error('Ada barang yang sudah tidak tersedia.');
    const oldByProduct = new Map<number, { qty: number; price: bigint; cost: bigint }>();
    for (const item of sale.items) {
      const previous = oldByProduct.get(item.productId);
      if (previous) throw new Error('Penjualan lama memiliki barang duplikat; koreksi manual diperlukan.');
      oldByProduct.set(item.productId, { qty: item.qty, price: item.priceAtSale, cost: item.costAtSale });
    }
    const productById = new Map(products.map((product) => [product.id, product]));
    const allIds = [...new Set([...oldByProduct.keys(), ...requested.keys()])].sort((a, b) => a - b);
    for (const productId of allIds) {
      const oldQty = oldByProduct.get(productId)?.qty ?? 0;
      const newQty = requested.get(productId)?.qty ?? 0;
      const delta = newQty - oldQty;
      if (delta > 0) {
        const changed = await tx.product.updateMany({
          where: { id: productId, stock: { gte: delta } }, data: { stock: { decrement: delta } },
        });
        if (changed.count !== 1) throw new Error(`Stok barang #${productId} tidak cukup untuk koreksi.`);
      } else if (delta < 0) {
        await tx.product.update({ where: { id: productId }, data: { stock: { increment: -delta } } });
      }
    }

    let totalRevenue = 0n;
    let totalProfit = 0n;
    const lines = [...requested.entries()].map(([productId, item]) => {
      const original = oldByProduct.get(productId);
      const product = productById.get(productId)!;
      const priceAtSale = original?.price ?? product.sellPrice;
      const costAtSale = original?.cost ?? product.costPrice;
      if (item.expectedPrice !== priceAtSale.toString()) {
        throw new Error(`Harga ${product.name} berubah. Minta asisten menyiapkan draf baru.`);
      }
      const revenue = priceAtSale * BigInt(item.qty);
      const profit = (priceAtSale - costAtSale) * BigInt(item.qty);
      totalRevenue += revenue;
      totalProfit += profit;
      return { saleId: sale.id, productId, qty: item.qty, priceAtSale, costAtSale, revenue, profit };
    });
    await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
    await tx.saleItem.createMany({ data: lines });
    await tx.saleTransaction.update({ where: { id: sale.id }, data: { totalRevenue, totalProfit } });
    return { saleId: sale.id };
  }, { timeout: 15_000 });
  for (const path of ['/', '/transaksi', '/inventory', '/harga', '/laporan', '/serah-terima']) revalidatePath(path);
  return result;
}

export async function recordSale(productId: number, qty: number) {
  if (qty <= 0) throw new Error('Qty harus > 0');
  const me = await getCurrentUser();
  return await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    if (product.stock < qty) {
      throw new Error(`Stok ${product.name} tidak cukup (sisa ${product.stock})`);
    }
    const priceAtSale = product.sellPrice;
    const costAtSale = product.costPrice;
    const revenue = priceAtSale * BigInt(qty);
    const profit = (priceAtSale - costAtSale) * BigInt(qty);

    await tx.product.update({
      where: { id: productId },
      data: { stock: { decrement: qty } },
    });

    const sale = await tx.saleTransaction.create({
      data: { totalRevenue: revenue, totalProfit: profit, userId: me?.id ?? null },
    });
    await tx.saleItem.create({
      data: {
        saleId: sale.id,
        productId,
        qty,
        priceAtSale,
        costAtSale,
        revenue,
        profit,
      },
    });
    revalidatePath('/inventory');
    revalidatePath('/');
    revalidatePath('/laporan');
    return sale;
  });
}

// ============================================================================
// BIAYA ADMIN (rekap harian: top up, transfer, tarik tunai, dll)
// User input: jumlah transaksi + total admin.
// Profit = total admin (otomatis).
// ============================================================================
export async function recordBiayaAdmin(data: {
  count: number;
  profit: number | string;
}) {
  if (!Number.isInteger(data.count) || data.count <= 0)
    throw new Error('Jumlah transaksi harus > 0');
  const profit = toBigIntSafe(data.profit);
  if (profit < 0n) throw new Error('Total admin tidak boleh negatif');
  const me = await getCurrentUser();
  const result = await prisma.serviceTransaction.create({
    data: { count: data.count, profit, userId: me?.id ?? null },
  });
  revalidatePath('/');
  revalidatePath('/laporan');
  revalidatePath('/transaksi');
  return result;
}

// ============================================================================
// EXPENSE
// Otomatis kurangi cash saat dicatat
// ============================================================================
export async function recordExpense(name: string, amount: number | string) {
  if (!name.trim()) throw new Error('Nama pengeluaran wajib diisi');
  const a = toBigIntSafe(amount);
  if (a <= 0n) throw new Error('Nominal harus > 0');
  const me = await getCurrentUser();
  const result = await prisma.expense.create({
    data: { name: name.trim(), amount: a, userId: me?.id ?? null },
  });
  revalidatePath('/');
  revalidatePath('/laporan');
  return result;
}

// ============================================================================
// SETTINGS
// ============================================================================
export async function updateSettings(data: {
  storeName: string;
  cashInitial: number | string;
  balanceInitial: number | string;
  theme: string;
}) {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {
      storeName: data.storeName.trim() || 'R CELL',
      cashInitial: toBigIntSafe(data.cashInitial),
      balanceInitial: toBigIntSafe(data.balanceInitial),
      theme: data.theme,
    },
    create: {
      id: 1,
      storeName: data.storeName.trim() || 'R CELL',
      cashInitial: toBigIntSafe(data.cashInitial),
      balanceInitial: toBigIntSafe(data.balanceInitial),
      theme: data.theme,
    },
  });
  revalidatePath('/');
  revalidatePath('/pengaturan');
}
