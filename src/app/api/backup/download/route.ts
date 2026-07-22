import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [settings, categories, subcategories, products, sales, saleItems, services, expenses] =
    await Promise.all([
      prisma.settings.findFirst(),
      prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.subcategory.findMany(),
      prisma.product.findMany(),
      prisma.saleTransaction.findMany(),
      prisma.saleItem.findMany(),
      prisma.serviceTransaction.findMany(),
      prisma.expense.findMany(),
    ]);
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings
      ? {
          ...settings,
          cashInitial: settings.cashInitial.toString(),
          balanceInitial: settings.balanceInitial.toString(),
        }
      : null,
    categories,
    subcategories,
    products: products.map((p) => ({ ...p, costPrice: p.costPrice.toString(), sellPrice: p.sellPrice.toString() })),
    sales,
    saleItems: saleItems.map((i) => ({ ...i, priceAtSale: i.priceAtSale.toString(), costAtSale: i.costAtSale.toString(), revenue: i.revenue.toString(), profit: i.profit.toString() })),
    services: services.map((s) => ({ ...s, profit: s.profit.toString() })),
    expenses: expenses.map((e) => ({ ...e, amount: e.amount.toString() })),
  };
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="rcms-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
