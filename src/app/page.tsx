import { AppHeader } from '@/components/app-header';
import { DashboardClient } from './dashboard-client';
import { computeDashboard, computeShiftCash } from '@/lib/automation';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { startOfDay } from '@/lib/utils';
import { WorkbenchClient } from './workbench-client';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await requireUser();
  if (me.role === 'karyawan') {
    const [products, popular, recentSales, closingChecks, shiftCash] = await Promise.all([
      prisma.product.findMany({
        select: { id: true, name: true, stock: true, sellPrice: true, categoryId: true, provider: true, validity: true, category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.saleItem.groupBy({
        by: ['productId'], _sum: { qty: true }, orderBy: { _sum: { qty: 'desc' } }, take: 12,
      }),
      prisma.saleTransaction.findMany({
        where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 4,
        select: { id: true, createdAt: true, items: { select: { qty: true, product: { select: { name: true } } } } },
      }),
      prisma.stockOpname.count({
        where: { userId: me.id, createdAt: { gte: startOfDay() }, note: 'Cek stok tutup shift' },
      }),
      computeShiftCash(me.id, startOfDay(), new Date()),
    ]);
    return <><AppHeader user={me} /><WorkbenchClient
      username={me.username} userId={me.id} shift={me.shift}
      hasClosingStockCheck={closingChecks > 0}
      shiftCash={{ openingCash: Number(shiftCash.openingCash), cashIn: Number(shiftCash.cashIn), cashOut: Number(shiftCash.cashOut), expectedCash: Number(shiftCash.expectedCash) }}
      products={products.map(({ category, sellPrice, ...product }) => ({ ...product, categoryName: category.name, sellPrice: Number(sellPrice) }))}
      popularIds={popular.map((item) => item.productId)}
      recentSales={recentSales.map((sale) => ({ id: sale.id, createdAt: sale.createdAt.toISOString(), items: sale.items.map((item) => ({ name: item.product.name, qty: item.qty })) }))}
    /></>;
  }
  const data = await computeDashboard().catch(() => null);
  return (
    <>
      <AppHeader user={me} />
      <DashboardClient
        isKaryawan={false}
        data={
          data ?? {
            totalModal: 0n,
            cash: 0n,
            totalSaldo: 0n,
            inventoryValue: 0n,
            omzetHari: 0n,
            profitHari: 0n,
            produkHampirHabis: [],
            produkHabis: 0,
            produkMenipis: 0,
            grafikPenjualan: [],
          }
        }
      />
    </>
  );
}
