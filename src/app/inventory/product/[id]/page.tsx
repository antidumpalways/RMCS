import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { ProductDetailClient } from './product-detail-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();
  const p = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subcategory: true, location: true },
  });
  if (!p) notFound();
  const [allCategories, subs, locations] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.subcategory.findMany({
      where: { categoryId: p.categoryId },
      orderBy: { name: 'asc' },
    }),
    prisma.location.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <ProductDetailClient
        isKaryawan={me.role === 'karyawan'}
        product={{
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
        }}
        categories={allCategories}
        subcategories={subs}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      />
    </>
  );
}
