'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { toBigIntSafe } from '@/lib/utils';
import { getCurrentUser } from '@/lib/auth';

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
    const newPaid = debt.paid + amount;
    const newStatus = newPaid >= debt.amount ? 'LUNAS' : 'BELUM';
    await tx.debt.update({
      where: { id: data.debtId },
      data: { paid: newPaid, status: newStatus },
    });
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

  const [sales, services, expenses] = await Promise.all([
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
  ]);

  const salesRevenue = sales.reduce((a, s) => a + s.totalRevenue, 0n);
  const salesProfit = sales.reduce((a, s) => a + s.totalProfit, 0n);
  const servicesProfit = services.reduce((a, s) => a + s.profit, 0n);
  const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0n);

  await prisma.shiftClosure.create({
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
      note: note?.trim() || null,
    },
  });
  revalidatePath('/transaksi');
  revalidatePath('/laporan');
  return {
    salesCount: sales.length,
    salesRevenue,
    salesProfit,
    servicesCount: services.length,
    servicesProfit,
    expensesTotal,
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
  const product = await prisma.product.findUniqueOrThrow({ where: { id: data.productId } });
  const diff = data.physicalStock - product.stock;
  await prisma.stockOpname.create({
    data: {
      productId: data.productId,
      systemStock: product.stock,
      physicalStock: data.physicalStock,
      diff,
      note: data.note?.trim() || null,
      userId: me?.id ?? null,
    },
  });
  revalidatePath('/inventory');
  revalidatePath('/opname');
}

export async function applyStockOpname(id: number) {
  // Apply hasil opname ke Product.stock
  const opname = await prisma.stockOpname.findUniqueOrThrow({ where: { id } });
  await prisma.product.update({
    where: { id: opname.productId },
    data: { stock: opname.physicalStock },
  });
  revalidatePath('/inventory');
  revalidatePath('/opname');
}

export async function deleteStockOpname(id: number) {
  await prisma.stockOpname.delete({ where: { id } });
  revalidatePath('/opname');
}

// ============================================================================
// SALES (barang terjual)
// Stok berkurang, omzet & profit bertambah otomatis
// ============================================================================
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
