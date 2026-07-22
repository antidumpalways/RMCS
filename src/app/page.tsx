import { AppHeader } from '@/components/app-header';
import { DashboardClient } from './dashboard-client';
import { computeDashboard } from '@/lib/automation';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await requireUser();
  const data = await computeDashboard().catch(() => null);
  return (
    <>
      <AppHeader user={me} />
      <DashboardClient
        isKaryawan={me.role === 'karyawan'}
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
