import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { LokasiClient } from './lokasi-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function LokasiPage() {
  const me = await requireUser();
  if (me.role === 'karyawan') redirect('/');
  const locations = await prisma.location.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      _count: { select: { products: true } },
    },
  });
  return (
    <>
      <AppHeader user={me} />
      <LokasiClient
        locations={locations.map((l) => ({
          id: l.id,
          name: l.name,
          sortOrder: l.sortOrder,
          productCount: l._count.products,
        }))}
      />
    </>
  );
}
