import Link from 'next/link';
import { Sun, Moon, ClipboardList } from 'lucide-react';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { computeShiftCash } from '@/lib/automation';
import { formatRupiah, startOfDay } from '@/lib/utils';
import { FinishShift } from '@/components/work-actions';

export const dynamic = 'force-dynamic';

export default async function ShiftPage() {
  const me = await requireUser();
  const [shiftCash, closingChecks] = await Promise.all([
    computeShiftCash(me.id),
    prisma.stockOpname.count({ where: { userId: me.id, createdAt: { gte: startOfDay() }, note: 'Cek stok tutup shift' } }),
  ]);
  const cash = { openingCash: Number(shiftCash.openingCash), cashIn: Number(shiftCash.cashIn), cashOut: Number(shiftCash.cashOut), expectedCash: Number(shiftCash.expectedCash) };

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl border bg-card p-5">
        <p className="text-xs font-medium text-muted-foreground">Kas seharusnya di laci</p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatRupiah(cash.expectedCash)}</p>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Kas awal</dt><dd className="tabular-nums">{formatRupiah(cash.openingCash)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Uang masuk</dt><dd className="tabular-nums text-emerald-600 dark:text-emerald-400">+ {formatRupiah(cash.cashIn)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Uang keluar</dt><dd className="tabular-nums text-orange-600 dark:text-orange-400">− {formatRupiah(cash.cashOut)}</dd></div>
        </dl>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/cek-stok?mode=buka" className="flex min-h-24 flex-col justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <Sun className="h-6 w-6 text-amber-700 dark:text-amber-300" /><span><span className="block text-sm font-bold">Cek stok buka</span><span className="text-xs text-muted-foreground">Hitung stok awal</span></span>
        </Link>
        <Link href="/cek-stok?mode=tutup" className="flex min-h-24 flex-col justify-between rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/30">
          <Moon className="h-6 w-6 text-indigo-700 dark:text-indigo-300" /><span><span className="block text-sm font-bold">Cek stok tutup</span><span className="text-xs text-muted-foreground">Hitung stok akhir</span></span>
        </Link>
      </div>
      <FinishShift hasClosingStockCheck={closingChecks > 0} shiftCash={cash} />
      <Link href="/serah-terima" className="flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 text-sm font-semibold"><ClipboardList className="h-5 w-5 text-primary" /> Lihat catatan serah terima</Link>
    </div>
  );
}
