import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ClipboardCheck, MessageSquareText } from 'lucide-react';
import { AppHeader } from '@/components/app-header';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { formatDateTimeID, formatRupiah, startOfDay } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SerahTerimaPage() {
  const me = await requireUser();
  const closure = await prisma.shiftClosure.findFirst({
    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
    include: { user: { select: { username: true } } },
  });

  const stockChecks = closure ? await prisma.stockOpname.findMany({
    where: {
      userId: closure.userId,
      createdAt: { gte: startOfDay(closure.closedAt), lte: closure.closedAt },
      note: { in: ['Cek stok buka shift', 'Cek stok tutup shift'] },
      diff: { not: 0 },
    },
    include: { product: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }) : [];

  return <>
    <AppHeader user={me} />
    <div className="space-y-5 pb-4">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Beranda</Link>
      <div><p className="mb-1 text-xs font-medium text-primary">SHIFT TERAKHIR</p><h1 className="text-2xl font-bold tracking-tight">Serah Terima Shift</h1><p className="mt-1 text-sm text-muted-foreground">Ringkasan penjualan, cek stok, dan pesan untuk shift berikutnya.</p></div>

      {!closure ? <div className="rounded-2xl border border-dashed p-8 text-center"><ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" /><p className="text-sm font-semibold">Belum ada serah terima</p><p className="mt-1 text-xs text-muted-foreground">Rekap akan tampil di sini setelah karyawan menyelesaikan shift.</p></div> : <>
        <div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Ditutup oleh</p><p className="mt-1 font-semibold">{closure.user.username} · Shift {closure.shift}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTimeID(closure.closedAt)}</p></div>

        <section aria-labelledby="handover-summary">
          <h2 id="handover-summary" className="mb-2 text-sm font-semibold">Ringkasan kerja</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Penjualan</span><strong>{closure.salesCount}</strong> transaksi</div>
            <div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Rekap jasa</span><strong>{closure.servicesCount}</strong> transaksi</div>
            <div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Cek stok saat buka</span><strong>{closure.openingStockCount}</strong> barang</div>
            <div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Cek stok saat tutup</span><strong>{closure.closingStockCount}</strong> barang</div>
          </div>
          {me.role === 'owner' && <div className="mt-2 grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Omzet barang</span><strong>{formatRupiah(closure.salesRevenue)}</strong></div><div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Profit penjualan</span><strong>{formatRupiah(closure.salesProfit)}</strong></div><div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Profit jasa</span><strong>{formatRupiah(closure.servicesProfit)}</strong></div><div className="rounded-xl border bg-card p-3"><span className="block text-xs text-muted-foreground">Pengeluaran</span><strong>{formatRupiah(closure.expensesTotal)}</strong></div></div>}
        </section>

        <section aria-labelledby="handover-cash">
          <h2 id="handover-cash" className="mb-2 text-sm font-semibold">Kas shift</h2>
          <div className="rounded-2xl border bg-card p-4 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Kas awal</span><span>{formatRupiah(closure.openingCash)}</span></div>
            <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Uang masuk</span><span className="text-emerald-600 dark:text-emerald-400">+ {formatRupiah(closure.cashIn)}</span></div>
            <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Uang keluar</span><span className="text-orange-600 dark:text-orange-400">− {formatRupiah(closure.cashOut)}</span></div>
            <div className="mt-2 flex justify-between gap-3 border-t pt-2 font-semibold"><span>Seharusnya</span><span>{formatRupiah(closure.expectedCash)}</span></div>
            <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Kas fisik</span><span className="font-semibold">{closure.actualCash === null ? '—' : formatRupiah(closure.actualCash)}</span></div>
            <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Selisih</span><strong className={!closure.cashDifference ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{closure.cashDifference === null ? '—' : `${closure.cashDifference > 0n ? '+' : closure.cashDifference < 0n ? '-' : ''}${formatRupiah(closure.cashDifference < 0n ? -closure.cashDifference : closure.cashDifference)}`}</strong></div>
          </div>
        </section>

        <section aria-labelledby="handover-stock">
          <div className="mb-2 flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /><h2 id="handover-stock" className="text-sm font-semibold">Catatan selisih stok</h2></div>
          {stockChecks.length ? <div className="divide-y rounded-2xl border bg-card px-4">{stockChecks.map((check) => <div key={check.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium">{check.product.name}</p><p className="text-xs text-muted-foreground">{check.note === 'Cek stok buka shift' ? 'Saat buka' : 'Saat tutup'} · {check.reviewStatus === 'APPLIED' ? 'stok disesuaikan owner' : check.reviewStatus === 'REVIEWED' ? 'sudah ditinjau owner' : 'menunggu owner'}</p></div><div className="shrink-0 text-right text-xs"><div>Sistem {check.systemStock} → Fisik {check.physicalStock}</div><strong className={check.diff < 0 ? 'text-rose-600' : 'text-amber-600'}>{check.diff > 0 ? `+${check.diff}` : check.diff}</strong></div></div>)}</div> : <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Tidak ada selisih dari hasil cek stok shift ini.</div>}
          <p className="mt-2 text-xs text-muted-foreground">Total catatan selisih saat shift ditutup: {closure.stockDiscrepancyCount}.</p>
        </section>

        <section aria-labelledby="handover-note">
          <div className="mb-2 flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-primary" /><h2 id="handover-note" className="text-sm font-semibold">Pesan untuk shift berikutnya</h2></div>
          <div className="rounded-2xl border bg-card p-4 text-sm leading-relaxed">{closure.note?.trim() ? <p className="whitespace-pre-wrap">{closure.note}</p> : <p className="text-muted-foreground">Tidak ada pesan tambahan.</p>}</div>
        </section>
      </>}
    </div>
  </>;
}
