import { AppHeader } from '@/components/app-header';
import { TransaksiClient } from './transaksi-client';
import { prisma } from '@/lib/prisma';
import { endOfDay, startOfDay, toDateInputLocal } from '@/lib/utils';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; shift?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const today = new Date();
  const dateStr = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : toDateInputLocal(today);
  const dayStart = startOfDay(new Date(dateStr + 'T00:00:00'));
  const dayEnd = endOfDay(dayStart);
  const shiftFilter = sp.shift && ['siang', 'malam'].includes(sp.shift) ? sp.shift : null;

  const whereByDate = shiftFilter
    ? { createdAt: { gte: dayStart, lte: dayEnd }, user: { shift: shiftFilter } }
    : { createdAt: { gte: dayStart, lte: dayEnd } };

  const [products, sales, services, expenses, categories, subcategories] = await Promise.all([
    prisma.product.findMany({
      where: { stock: { gt: 0 } },
      include: { category: true, subcategory: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
    prisma.saleTransaction.findMany({
      where: whereByDate,
      include: { items: { include: { product: true } }, user: { select: { username: true, shift: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.serviceTransaction.findMany({
      where: whereByDate,
      include: { user: { select: { username: true, shift: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.expense.findMany({
      where: whereByDate,
      include: { user: { select: { username: true, shift: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.subcategory.findMany({ orderBy: { name: 'asc' } }),
  ]);

  // Hitung ringkasan harian otomatis
  let totalRevenue = 0n;
  let totalProfit = 0n;
  for (const s of sales) {
    totalRevenue += s.totalRevenue;
    totalProfit += s.totalProfit;
  }
  let serviceRevenue = 0n;
  let serviceProfit = 0n;
  let serviceCount = 0;
  for (const s of services) {
    serviceRevenue += s.profit;
    serviceProfit += s.profit;
    serviceCount += s.count;
  }
  let totalExpense = 0n;
  for (const e of expenses) {
    totalExpense += e.amount;
  }

  return (
    <>
      <AppHeader user={me} />
      <TransaksiClient
        isKaryawan={me.role === 'karyawan'}
        date={dateStr}
        shift={shiftFilter}
        summary={{
          totalRevenue,
          totalProfit,
          serviceRevenue,
          serviceProfit,
          serviceCount,
          totalExpense,
          salesCount: sales.length,
          servicesCount: services.length,
          expensesCount: expenses.length,
        }}
        categories={categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder }))}
        subcategories={subcategories.map((s) => ({
          id: s.id,
          name: s.name,
          categoryId: s.categoryId,
        }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          stock: p.stock,
          costPrice: Number(p.costPrice),
          sellPrice: Number(p.sellPrice),
          categoryId: p.categoryId,
          categoryName: p.category.name,
          subcategoryId: p.subcategoryId,
          subcategoryName: p.subcategory?.name ?? null,
          provider: p.provider,
          validity: p.validity,
        }))}
        sales={sales.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          totalRevenue: Number(s.totalRevenue),
          totalProfit: Number(s.totalProfit),
          userShift: s.user?.shift ?? null,
          userName: s.user?.username ?? null,
          items: s.items.map((i) => ({
            productName: i.product.name,
            qty: i.qty,
            priceAtSale: Number(i.priceAtSale),
          })),
        }))}
        services={services.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          count: s.count,
          profit: Number(s.profit),
          userShift: s.user?.shift ?? null,
          userName: s.user?.username ?? null,
        }))}
        expenses={expenses.map((e) => ({
          id: e.id,
          createdAt: e.createdAt.toISOString(),
          name: e.name,
          amount: Number(e.amount),
          userShift: e.user?.shift ?? null,
          userName: e.user?.username ?? null,
        }))}
      />
    </>
  );
}
