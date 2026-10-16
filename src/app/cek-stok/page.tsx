import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { CekStokClient } from './cek-stok-client';

export const dynamic = 'force-dynamic';

export default async function CekStokPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const me = await requireUser();
  if (me.role !== 'karyawan') redirect('/opname');
  const params = await searchParams;
  const phase = params.mode === 'buka' || params.mode === 'tutup' ? params.mode : null;
  const products = await prisma.product.findMany({
    include: {
      category: { select: { name: true, sortOrder: true } },
      location: { select: { name: true } },
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
  });

  return (
    <>
      <AppHeader user={me} />
      <CekStokClient
        phase={phase}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryName: product.category.name,
          locationName: product.location?.name ?? null,
          systemStock: product.stock,
        }))}
      />
    </>
  );
}
