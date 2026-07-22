import { AppHeader } from '@/components/app-header';
import { HargaClient } from './harga-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function HargaPage() {
  const me = await requireUser();
  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      include: { category: { select: { id: true, name: true, sortOrder: true } }, location: true },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { provider: 'asc' },
        { validity: 'asc' },
        { name: 'asc' },
      ],
    }),
    prisma.location.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <HargaClient
        isKaryawan={me.role === 'karyawan'}
        locations={locations.map((l) => ({ id: l.id, name: l.name, sortOrder: l.sortOrder }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          categoryId: p.categoryId,
          categoryName: p.category.name,
          provider: p.provider,
          validity: p.validity,
          locationId: p.locationId,
          locationName: p.location?.name ?? null,
          stock: p.stock,
          costPrice: Number(p.costPrice),
          sellPrice: Number(p.sellPrice),
        }))}
      />
    </>
  );
}
