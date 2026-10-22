'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown, ClipboardCheck, PackagePlus, NotebookPen, ShoppingBag, Sun, Moon, History } from 'lucide-react';
import { QuickSale, type SaleProduct } from '@/components/quick-sale';
import { WorkEntry, FinishShift } from '@/components/work-actions';

type RecentSale = { id: number; createdAt: string; items: { name: string; qty: number }[] };

export function WorkbenchClient({ username, userId, shift, hasClosingStockCheck, shiftCash, products, popularIds, recentSales }: {
  username: string;
  userId: number;
  shift: string | null;
  hasClosingStockCheck: boolean;
  shiftCash: { openingCash: number; cashIn: number; cashOut: number; expectedCash: number };
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

    <section aria-labelledby="sell-section">
      <div className="mb-3">
        <h2 id="sell-section" className="text-sm font-semibold">Catat Penjualan</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pilih barang yang dibeli, atur jumlahnya, lalu simpan.</p>
      </div>
      <QuickSale home products={products} popularIds={popularIds} userId={userId} />
    </section>

    <section aria-labelledby="stock-check-section">
      <div className="mb-3">
        <h2 id="stock-check-section" className="text-sm font-semibold">Cek stok saat buka dan tutup</h2>
        <p className="mt-1 text-xs text-muted-foreground">Cocokkan dengan catatan manual. Selisih dikirim ke owner untuk diperiksa.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/cek-stok?mode=buka" className="flex min-h-20 items-center gap-2 rounded-2xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"><Sun className="h-4 w-4" /></span>
          <span className="min-w-0"><span className="block text-sm font-semibold">Saat buka</span><span className="block text-[11px] text-muted-foreground">Hitung stok awal</span></span>
        </Link>
        <Link href="/cek-stok?mode=tutup" className="flex min-h-20 items-center gap-2 rounded-2xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600"><Moon className="h-4 w-4" /></span>
          <span className="min-w-0"><span className="block text-sm font-semibold">Saat tutup</span><span className="block text-[11px] text-muted-foreground">Hitung stok akhir</span></span>
        </Link>
      </div>
      <Link href="/cek-stok" className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary"><ClipboardCheck className="h-3.5 w-3.5" /> Buka menu cek stok <ArrowRight className="h-3.5 w-3.5" /></Link>
    </section>

    <details className="group rounded-2xl border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">Menu lainnya <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
      <div className="border-t p-3"><p className="mb-3 text-xs text-muted-foreground">Buka jika perlu mencatat transaksi selain penjualan.</p><div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
      <WorkEntry kind="admin" /><WorkEntry kind="expense" />
      <Link href="/piutang" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><NotebookPen className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-semibold">Bon Pelanggan</span><span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">Piutang</span></span><span className="mt-0.5 block text-xs text-muted-foreground">Catat bon atau pembayaran</span></span></Link>
      <Link href="/inventory" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400"><PackagePlus className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-semibold">Barang Masuk</span><span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">Stok</span></span><span className="mt-0.5 block text-xs text-muted-foreground">Pilih barang &amp; tambah stok</span></span></Link>
      </div></div>
    </details>

    <section aria-labelledby="recent-sales"><div className="mb-3 flex items-center justify-between gap-2"><h2 id="recent-sales" className="text-sm font-semibold">Terakhir kamu catat</h2><Link href="/transaksi" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary">Riwayat <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      {recentSales.length ? <div className="divide-y rounded-2xl border bg-card px-4">{recentSales.map((sale) => <div key={sale.id} className="flex items-start gap-3 py-3.5"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingBag className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium leading-relaxed">{sale.items.map((item) => `${item.name} × ${item.qty}`).join(', ')}</p><p className="mt-1 text-xs text-muted-foreground">Penjualan #{sale.id} · {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(sale.createdAt))}</p></div><span className="mt-1 text-xs font-medium text-primary">Tercatat ✓</span></div>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center"><History className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" /><p className="text-sm font-medium">Siap untuk penjualan pertama?</p><p className="mt-1 text-xs text-muted-foreground">Transaksi yang kamu catat akan muncul di sini.</p></div>}
    </section>
    <FinishShift hasClosingStockCheck={hasClosingStockCheck} shiftCash={shiftCash} />
  </div>;
}
