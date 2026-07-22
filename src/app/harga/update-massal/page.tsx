import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { BulkPriceClient } from './bulk-price-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function BulkPricePage() {
  const me = await requireUser();
  if (me.role === 'karyawan') redirect('/');
  const [categories, subcategories] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { products: true } } } }),
    prisma.subcategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <BulkPriceClient
        categories={categories.map((c) => ({ id: c.id, name: c.name, productCount: c._count.products }))}
        subcategories={subcategories.map((s) => ({
          id: s.id,
          name: s.name,
          categoryId: s.categoryId,
          productCount: s._count.products,
        }))}
      />
    </>
  );
}
