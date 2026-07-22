// automation.ts - semua kalkulasi otomatis RCMS
// Profit = Harga Jual - Modal (tidak pernah diinput manual)
import { prisma } from './prisma';
import { endOfDay, startOfDay, startOfMonth, endOfMonth } from './utils';

// ============================================================================
// TIPE DASAR
// ============================================================================
export type DashboardSummary = {
  totalModal: bigint; // Σ (costPrice * stock) seluruh produk
  cash: bigint; // cashInitial + Σ (revenue sale barang + profit service) - Σ expense
  totalSaldo: bigint; // balanceInitial (sederhana: tidak ada mutasi saldo di v1)
  inventoryValue: bigint; // Σ (sellPrice * stock)
  omzetHari: bigint;
  profitHari: bigint;
  produkHampirHabis: Array<{
    id: number;
    name: string;
    stock: number;
    minStock: number;
  }>;
  produkHabis: number; // count produk stok = 0
  produkMenipis: number; // count produk 0 < stok <= minStock
  grafikPenjualan: Array<{ date: string; revenue: bigint; profit: bigint }>; // 7 hari terakhir
};

// ============================================================================
// HELPERS
// ============================================================================
async function ensureSettings() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, storeName: 'R CELL', cashInitial: 0n, balanceInitial: 0n },
  });
  return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function last7Days(): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

// ============================================================================
// KALKULASI PRODUK
// ============================================================================
export async function computeProductStats() {
  const products = await prisma.product.findMany({
    select: { costPrice: true, sellPrice: true, stock: true },
  });
  let totalModal = 0n;
  let inventoryValue = 0n;
  let totalStockUnits = 0;
  for (const p of products) {
    const stock = BigInt(p.stock);
    totalModal += p.costPrice * stock;
    inventoryValue += p.sellPrice * stock;
    totalStockUnits += p.stock;
  }
  return {
    totalProducts: products.length,
    totalStockUnits,
    totalModal,
    inventoryValue,
    potentialProfit: inventoryValue - totalModal,
  };
}

export async function getLowStockProducts() {
  // Stok <= minStock dianggap menipis, stock 0 dianggap habis
  const all = await prisma.product.findMany({
    select: { id: true, name: true, stock: true, minStock: true },
    orderBy: [{ stock: 'asc' }, { minStock: 'desc' }],
  });
  return all.filter((p) => p.stock <= p.minStock);
}

export type StockAlert = {
  totalLow: number; // total produk menipis (stok <= minStock)
  totalOut: number; // total produk habis (stok = 0)
  products: Array<{ id: number; name: string; stock: number; minStock: number }>;
};

export async function getStockAlert(): Promise<StockAlert> {
  const products = await getLowStockProducts();
  return {
    totalLow: products.length,
    totalOut: products.filter((p) => p.stock === 0).length,
    products,
  };
}

// ============================================================================
// KALKULASI TRANSAKSI (rentang waktu)
// ============================================================================
export async function computeTransactionStats(from: Date, to: Date) {
  const sales = await prisma.saleTransaction.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { totalRevenue: true, totalProfit: true },
  });
  const services = await prisma.serviceTransaction.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { profit: true, count: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { amount: true },
  });

  let omzet = 0n;
  let profit = 0n;
  for (const s of sales) {
    omzet += s.totalRevenue;
    profit += s.totalProfit;
  }
  for (const s of services) {
    omzet += s.profit; // total admin dihitung sebagai omzet
    profit += s.profit;
  }
  const totalExpense = expenses.reduce((a, e) => a + e.amount, 0n);

  return { omzet, profit, totalExpense, salesCount: sales.length, servicesCount: services.length };
}

// ============================================================================
// CASH CALCULATION
// Cash = cashInitial + (Σ revenue dari semua sale barang) + (Σ profit service) - Σ expense
// Catatan: untuk service (topup/transfer/withdraw), customer bayar "nominal",
// modal kita adalah "cost", dan kita tidak hitung nominal sebagai cash masuk
// karena cash fisik yang bertambah = profit saja (nominal dipakai untuk beli produk/jasa).
// Tapi: untuk topup/transfer/withdraw, cash yang masuk = profit saja.
// ============================================================================
export async function computeCash() {
  const s = await ensureSettings();
  const sales = await prisma.saleTransaction.aggregate({
    _sum: { totalRevenue: true },
  });
  const serviceProfit = await prisma.serviceTransaction.aggregate({
    _sum: { profit: true },
  });
  const expenses = await prisma.expense.aggregate({
    _sum: { amount: true },
  });
  return (
    s.cashInitial +
    (sales._sum.totalRevenue ?? 0n) +
    (serviceProfit._sum.profit ?? 0n) -
    (expenses._sum.amount ?? 0n)
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================
export async function computeDashboard(): Promise<DashboardSummary> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [settings, productStats, lowStock, todayStats, sales7d, services7d] = await Promise.all([
    ensureSettings(),
    computeProductStats(),
    getLowStockProducts(),
    computeTransactionStats(startOfDay(), endOfDay()),
    prisma.saleTransaction.findMany({
      where: { createdAt: { gte: since7d } },
      select: { createdAt: true, totalRevenue: true, totalProfit: true },
    }),
    prisma.serviceTransaction.findMany({
      where: { createdAt: { gte: since7d } },
      select: { createdAt: true, profit: true },
    }),
  ]);

  // Grafik 7 hari terakhir
  const days = last7Days();
  const buckets = new Map<string, { revenue: bigint; profit: bigint }>();
  for (const d of days) buckets.set(d, { revenue: 0n, profit: 0n });

  for (const s of sales7d) {
    const k = dayKey(s.createdAt);
    const b = buckets.get(k);
    if (b) {
      b.revenue += s.totalRevenue;
      b.profit += s.totalProfit;
    }
  }
  for (const s of services7d) {
    const k = dayKey(s.createdAt);
    const b = buckets.get(k);
    if (b) {
      b.revenue += s.profit;
      b.profit += s.profit;
    }
  }
  const grafik = days.map((d) => {
    const b = buckets.get(d)!;
    return {
      date: new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
      revenue: b.revenue,
      profit: b.profit,
    };
  });

  const cash = await computeCash();

  return {
    totalModal: productStats.totalModal,
    cash,
    totalSaldo: settings.balanceInitial,
    inventoryValue: productStats.inventoryValue,
    omzetHari: todayStats.omzet,
    profitHari: todayStats.profit,
    produkHampirHabis: lowStock.map((p) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      minStock: p.minStock,
    })),
    produkHabis: lowStock.filter((p) => p.stock === 0).length,
    produkMenipis: lowStock.filter((p) => p.stock > 0).length,
    grafikPenjualan: grafik,
  };
}

// ============================================================================
// LAPORAN
// ============================================================================
export type ReportData = {
  omzetHari: bigint;
  profitHari: bigint;
  omzetBulan: bigint;
  profitBulan: bigint;
  totalExpenseBulan: bigint;
  stokTotal: number;
  nilaiInventory: bigint;
  nilaiModal: bigint;
  potentialProfit: bigint;
  produkTerlaris: Array<{ name: string; qty: number; revenue: bigint }>;
  kategoriTerlaris: Array<{ name: string; qty: number; revenue: bigint }>;
};

export async function computeReport(from: Date, to: Date): Promise<ReportData> {
  const [today, month, productStats] = await Promise.all([
    computeTransactionStats(startOfDay(), endOfDay()),
    computeTransactionStats(startOfMonth(), endOfMonth()),
    computeProductStats(),
  ]);

  // Produk & kategori terlaris dalam rentang filter
  const items = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: from, lte: to } } },
    include: { product: { include: { category: true } } },
  });

  const byProduct = new Map<number, { name: string; qty: number; revenue: bigint }>();
  const byCategory = new Map<number, { name: string; qty: number; revenue: bigint }>();
  for (const it of items) {
    const p = byProduct.get(it.productId) ?? { name: it.product.name, qty: 0, revenue: 0n };
    p.qty += it.qty;
    p.revenue += it.revenue;
    byProduct.set(it.productId, p);

    const c = byCategory.get(it.product.categoryId) ?? {
      name: it.product.category.name,
      qty: 0,
      revenue: 0n,
    };
    c.qty += it.qty;
    c.revenue += it.revenue;
    byCategory.set(it.product.categoryId, c);
  }

  return {
    omzetHari: today.omzet,
    profitHari: today.profit,
    omzetBulan: month.omzet,
    profitBulan: month.profit,
    totalExpenseBulan: month.totalExpense,
    stokTotal: productStats.totalStockUnits,
    nilaiInventory: productStats.inventoryValue,
    nilaiModal: productStats.totalModal,
    potentialProfit: productStats.potentialProfit,
    produkTerlaris: [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
    kategoriTerlaris: [...byCategory.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
  };
}

// ============================================================================
// INVENTORY PER CATEGORY
// ============================================================================
export type CategorySummary = {
  id: number;
  name: string;
  productCount: number;
  totalStock: number;
  totalModal: bigint;
  totalJual: bigint;
  potentialProfit: bigint;
};

export async function getCategoriesWithSummary(): Promise<CategorySummary[]> {
  const cats = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      products: {
        select: { costPrice: true, sellPrice: true, stock: true },
      },
    },
  });
  return cats.map((c) => {
    let totalStock = 0;
    let totalModal = 0n;
    let totalJual = 0n;
    for (const p of c.products) {
      totalStock += p.stock;
      const s = BigInt(p.stock);
      totalModal += p.costPrice * s;
      totalJual += p.sellPrice * s;
    }
    return {
      id: c.id,
      name: c.name,
      productCount: c.products.length,
      totalStock,
      totalModal,
      totalJual,
      potentialProfit: totalJual - totalModal,
    };
  });
}
