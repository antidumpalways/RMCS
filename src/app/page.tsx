import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { DashboardClient } from './dashboard-client';
import { computeDashboard } from '@/lib/automation';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await requireUser();
  // Karyawan langsung masuk layar kasir.
  if (me.role === 'karyawan') redirect('/kasir');
  const [data, pendingOpname] = await Promise.all([
    computeDashboard().catch(() => null),
    prisma.stockOpname.count({ where: { diff: { not: 0 }, reviewStatus: 'PENDING' } }).catch(() => 0),
  ]);
  return (
    <>
      <AppHeader user={me} />
      <DashboardClient
        isKaryawan={false}
        pendingOpname={pendingOpname}
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
