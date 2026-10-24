'use client';

import Link from 'next/link';
import { ArrowRight, ChevronDown, ClipboardCheck, PackagePlus, NotebookPen, ShoppingBag, Sun, Moon, History, Sparkles } from 'lucide-react';
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
    <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-emerald-800 via-primary to-emerald-600 p-5 text-white shadow-xl shadow-emerald-900/15 sm:p-6">
      <div className="pointer-events-none absolute -right-12 -top-16 -z-10 h-48 w-48 rounded-full bg-lime-300/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 -z-10 h-40 w-40 rounded-full bg-teal-200/15 blur-2xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100"><Sparkles className="h-3.5 w-3.5" /> Senang kamu sudah datang</span>{shift && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold capitalize text-white backdrop-blur"><ShiftIcon className="h-3.5 w-3.5" /> Shift {shift}</span>}</div>
      <h1 className="relative mt-4 break-words text-2xl font-bold tracking-tight sm:text-3xl">Halo, {username} <span aria-hidden="true">👋</span></h1>
      <p className="relative mt-1 max-w-sm text-sm leading-relaxed text-emerald-50">Semoga lancar hari ini. Layani pelanggan satu per satu—catatannya biar kami bantu.</p>
    </section>

    <section aria-labelledby="sell-section">
      <div className="mb-3">
        <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><ShoppingBag className="h-4 w-4" /></span><div><h2 id="sell-section" className="text-base font-bold tracking-tight">Catat Penjualan</h2><p className="mt-0.5 text-xs text-muted-foreground">Pilih barang yang dibeli, atur jumlahnya, lalu simpan.</p></div></div>
      </div>
      <QuickSale home products={products} popularIds={popularIds} userId={userId} />
    </section>

    <section aria-labelledby="stock-check-section" className="space-y-3">
      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Rutinitas toko</p><h2 id="stock-check-section" className="mt-1 text-base font-bold tracking-tight">Cek stok</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cocokkan barang di rak dengan catatan. Owner akan meninjau jika ada selisih.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/cek-stok?mode=buka" className="group flex min-h-24 items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md dark:border-amber-900/50 dark:from-amber-950/30">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"><Sun className="h-5 w-5" /></span>
          <span className="min-w-0"><span className="block text-sm font-bold">Saat buka</span><span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Hitung stok awal</span></span>
        </Link>
        <Link href="/cek-stok?mode=tutup" className="group flex min-h-24 items-center gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-indigo-900/50 dark:from-indigo-950/30">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200"><Moon className="h-5 w-5" /></span>
          <span className="min-w-0"><span className="block text-sm font-bold">Saat tutup</span><span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Hitung stok akhir</span></span>
        </Link>
      </div>
      <Link href="/cek-stok" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary"><ClipboardCheck className="h-3.5 w-3.5" /> Lihat semua cek stok <ArrowRight className="h-3.5 w-3.5" /></Link>
    </section>

    <details className="group rounded-2xl border bg-card/85 shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold [&::-webkit-details-marker]:hidden">Menu lainnya <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
      <div className="border-t p-3"><p className="mb-3 text-xs text-muted-foreground">Buka jika perlu mencatat transaksi selain penjualan.</p><div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
      <WorkEntry kind="admin" /><WorkEntry kind="expense" />
      <Link href="/piutang" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"><NotebookPen className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-semibold">Bon Pelanggan</span><span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">Piutang</span></span><span className="mt-0.5 block text-xs text-muted-foreground">Catat bon atau pembayaran</span></span></Link>
      <Link href="/inventory" className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400"><PackagePlus className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-semibold">Barang Masuk</span><span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">Stok</span></span><span className="mt-0.5 block text-xs text-muted-foreground">Pilih barang &amp; tambah stok</span></span></Link>
      </div></div>
    </details>

    <section aria-labelledby="recent-sales"><div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Pencatatanmu</p><h2 id="recent-sales" className="mt-1 text-base font-bold tracking-tight">Terakhir kamu catat</h2></div><Link href="/transaksi" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/10">Riwayat <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      {recentSales.length ? <div className="divide-y rounded-2xl border bg-card px-4">{recentSales.map((sale) => <div key={sale.id} className="flex items-start gap-3 py-3.5"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShoppingBag className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium leading-relaxed">{sale.items.map((item) => `${item.name} × ${item.qty}`).join(', ')}</p><p className="mt-1 text-xs text-muted-foreground">Penjualan #{sale.id} · {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(sale.createdAt))}</p></div><span className="mt-1 text-xs font-medium text-primary">Tercatat ✓</span></div>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center"><History className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" /><p className="text-sm font-medium">Siap untuk penjualan pertama?</p><p className="mt-1 text-xs text-muted-foreground">Transaksi yang kamu catat akan muncul di sini.</p></div>}
    </section>
    <FinishShift hasClosingStockCheck={hasClosingStockCheck} shiftCash={shiftCash} />
  </div>;
}
