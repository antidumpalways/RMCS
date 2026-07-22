import { AppHeader } from '@/components/app-header';
import { InventoryClient } from './inventory-client';
import { getCategoriesWithSummary } from '@/lib/automation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const me = await requireUser();
  const [categories, allProducts, allSubs, locations] = await Promise.all([
    getCategoriesWithSummary(),
    prisma.product.findMany({
      include: { category: true, subcategory: true, location: true },
      orderBy: [{ provider: 'asc' }, { validity: 'asc' }, { name: 'asc' }],
    }),
    prisma.subcategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.location.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <InventoryClient
        isKaryawan={me.role === 'karyawan'}
        categories={categories}
        locations={locations.map((l) => ({ id: l.id, name: l.name, sortOrder: l.sortOrder }))}
        allProducts={allProducts.map((p) => ({
          id: p.id,
          name: p.name,
          categoryId: p.categoryId,
          categoryName: p.category.name,
          subcategoryId: p.subcategoryId,
          subcategoryName: p.subcategory?.name ?? null,
          provider: p.provider,
          validity: p.validity,
          locationId: p.locationId,
          locationName: p.location?.name ?? null,
          costPrice: Number(p.costPrice),
          sellPrice: Number(p.sellPrice),
          stock: p.stock,
          minStock: p.minStock,
        }))}
        subcategories={allSubs}
      />
    </>
  );
}
