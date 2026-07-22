import { AppHeader } from '@/components/app-header';
import { LaporanClient } from './laporan-client';
import { computeReport } from '@/lib/automation';
import { startOfMonth, endOfMonth } from '@/lib/utils';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const today = new Date();
  const from = sp.from ? new Date(sp.from) : startOfMonth(today);
  const to = sp.to ? new Date(sp.to) : endOfMonth(today);
  const data = await computeReport(
    from > to ? to : from,
    from > to ? from : to
  );
  return (
    <>
      <AppHeader user={me} />
      <LaporanClient
        isKaryawan={me.role === 'karyawan'}
        from={from.toISOString().slice(0, 10)}
        to={to.toISOString().slice(0, 10)}
        data={data}
      />
    </>
  );
}
