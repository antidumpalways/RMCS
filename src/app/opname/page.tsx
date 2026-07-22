import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { OpnameClient } from './opname-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function OpnamePage() {
  const me = await requireUser();
  if (me.role === 'karyawan') redirect('/');
  const [products, opnames] = await Promise.all([
    prisma.product.findMany({
      where: { stock: { gt: 0 } },
      include: { category: { select: { id: true, name: true, sortOrder: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
    prisma.stockOpname.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { product: { select: { name: true, stock: true } }, user: { select: { username: true } } },
    }),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <OpnameClient
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          categoryId: p.categoryId,
          categoryName: p.category.name,
          systemStock: p.stock,
        }))}
        opnames={opnames.map((o) => ({
          id: o.id,
          productName: o.product.name,
          systemStock: o.systemStock,
          physicalStock: o.physicalStock,
          diff: o.diff,
          note: o.note,
          userName: o.user?.username ?? null,
          createdAt: o.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
