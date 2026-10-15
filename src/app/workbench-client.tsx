'use client';

import Link from 'next/link';
import { ArrowRight, PackagePlus, NotebookPen, ShoppingBag, Sun, Moon, History } from 'lucide-react';
import { QuickSale, type SaleProduct } from '@/components/quick-sale';
import { WorkEntry, FinishShift } from '@/components/work-actions';

type RecentSale = { id: number; createdAt: string; items: { name: string; qty: number }[] };

export function WorkbenchClient({ username, userId, shift, products, popularIds, recentSales }: {
  username: string;
  userId: number;
  shift: string | null;
  products: SaleProduct[];
  popularIds: number[];
  recentSales: RecentSale[];
}) {
  const ShiftIcon = shift === 'malam' ? Moon : Sun;
  return <div className="space-y-7 pb-3">
    <section className="relative overflow-hidden rounded-3xl bg-primary/10 p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-primary/10" />
      <div className="relative flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-primary">SELAMAT BEKERJA</span>{shift && <span className="inline-flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5 text-xs font-medium capitalize"><ShiftIcon className="h-3.5 w-3.5" /> Shift {shift}</span>}</div>
      <h1 className="relative mt-3 break-words text-2xl font-bold tracking-tight">Halo, {username} <span aria-hidden="true">👋</span></h1>
      <p className="relative mt-1 text-sm leading-relaxed text-muted-foreground">Layani pelanggan, catat dengan mudah.</p>
    </section>

    <QuickSale home products={products} popularIds={popularIds} userId={userId} />

    <section aria-labelledby="other-actions"><div className="mb-3"><h2 id="other-actions" className="text-sm font-semibold">Mau catat yang lain?</h2><p className="mt-1 text-xs text-muted-foreground">Pilih sesuai kebutuhan, isi seperlunya.</p></div><div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
      <WorkEntry kind="admin" /><WorkEntry kind="expense" />
      <Link href="/piutang" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><NotebookPen className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">Bon Pelanggan</span><span className="mt-0.5 block text-xs text-muted-foreground">Catat bon atau pembayaran</span></span></Link>
      <Link href="/inventory" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400"><PackagePlus className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-semibold">Barang Masuk</span><span className="mt-0.5 block text-xs text-muted-foreground">Pilih barang & tambah stok</span></span></Link>
    </div></section>

    <section aria-labelledby="recent-sales"><div className="mb-3 flex items-center justify-between gap-2"><h2 id="recent-sales" className="text-sm font-semibold">Terakhir kamu catat</h2><Link href="/transaksi" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary">Riwayat <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      {recentSales.length ? <div className="divide-y rounded-2xl border bg-card px-4">{recentSales.map((sale) => <div key={sale.id} className="flex items-start gap-3 py-3.5"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingBag className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium leading-relaxed">{sale.items.map((item) => `${item.name} × ${item.qty}`).join(', ')}</p><p className="mt-1 text-xs text-muted-foreground">Penjualan #{sale.id} · {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(sale.createdAt))}</p></div><span className="mt-1 text-xs font-medium text-primary">Tercatat ✓</span></div>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center"><History className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" /><p className="text-sm font-medium">Siap untuk penjualan pertama?</p><p className="mt-1 text-xs text-muted-foreground">Transaksi yang kamu catat akan muncul di sini.</p></div>}
    </section>
    <FinishShift />
  </div>;
}
