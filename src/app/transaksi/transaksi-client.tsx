'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, Wallet, Receipt, CalendarDays, History, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QuickSale, type SaleProduct } from '@/components/quick-sale';
import { WorkEntry, FinishShift } from '@/components/work-actions';
import { ShiftBadge } from '@/components/shift-badge';
import { cn, formatRupiah, formatDateTimeID, toDateInputLocal } from '@/lib/utils';

type Sale = { id: number; kind: 'SALE' | 'RETURN'; createdAt: string; totalRevenue: number; totalProfit: number; userShift: string | null; userName: string | null; items: { productName: string; qty: number; priceAtSale: number }[] };
type Service = { id: number; createdAt: string; count: number; profit: number; userShift: string | null; userName: string | null };
type Expense = { id: number; createdAt: string; name: string; amount: number; userShift: string | null; userName: string | null };
type Summary = { totalRevenue: bigint; totalProfit: bigint; serviceRevenue: bigint; serviceProfit: bigint; serviceCount: number; totalExpense: bigint; salesCount: number; servicesCount: number; expensesCount: number };
type Props = { isKaryawan: boolean; hasClosingStockCheck: boolean; shiftCash: { openingCash: number; cashIn: number; cashOut: number; expectedCash: number }; userId: number; date: string; shift: string | null; summary: Summary; products: SaleProduct[]; sales: Sale[]; services: Service[]; expenses: Expense[] };

export function TransaksiClient({ isKaryawan, hasClosingStockCheck, shiftCash, userId, date, shift, summary, products, sales, services, expenses }: Props) {
  const router = useRouter();
  const [filterOpen, setFilterOpen] = React.useState(false);
  const today = toDateInputLocal();
  const changeFilter = (nextDate: string, nextShift: string | null) => {
    if (!nextDate) return;
    const params = new URLSearchParams({ date: nextDate });
    if (nextShift) params.set('shift', nextShift);
    router.push(`/transaksi?${params}`);
  };
  const activity = [
    ...sales.map((sale) => ({ key: `sale-${sale.id}`, type: sale.kind === 'RETURN' ? 'expense' as const : 'sale' as const, title: sale.items.map((item) => `${item.productName} × ${Math.abs(item.qty)}`).join(', '), subtitle: sale.kind === 'RETURN' ? 'Retur' : 'Penjualan', date: sale.createdAt, amount: sale.kind === 'RETURN' ? Math.abs(sale.totalRevenue) : sale.totalRevenue, userName: sale.userName, userShift: sale.userShift })),
    ...services.map((service) => ({ key: `service-${service.id}`, type: 'service' as const, title: `${service.count} transaksi jasa`, subtitle: 'Biaya admin', date: service.createdAt, amount: service.profit, userName: service.userName, userShift: service.userShift })),
    ...expenses.map((expense) => ({ key: `expense-${expense.id}`, type: 'expense' as const, title: expense.name, subtitle: 'Pengeluaran', date: expense.createdAt, amount: expense.amount, userName: expense.userName, userShift: expense.userShift })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-3"><div><p className="mb-1 text-xs font-medium text-primary">{isKaryawan ? 'PENJUALAN' : 'CATATAN TOKO'}</p><h1 className="text-2xl font-bold tracking-tight">{isKaryawan ? 'Jual Barang' : 'Transaksi'}</h1><p className="mt-1 text-sm text-muted-foreground">{date === today ? 'Aktivitas hari ini' : dateLabel}</p></div><Button variant="outline" className="shrink-0 rounded-xl" onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen} aria-controls="transaction-filters" aria-label="Filter tanggal dan shift"><CalendarDays className="h-4 w-4" /><span className="hidden min-[400px]:inline">Filter</span><ChevronDown className={cn('h-3 w-3 transition-transform', filterOpen && 'rotate-180')} /></Button></div>

    {filterOpen && <div id="transaction-filters" className="space-y-3 rounded-2xl border bg-card p-4"><label htmlFor="transaction-date" className="block text-sm font-medium">Tanggal riwayat</label><div className="flex gap-2"><Input id="transaction-date" type="date" value={date} onChange={(e) => changeFilter(e.target.value, shift)} className="min-w-0 flex-1" />{date !== today && <Button variant="secondary" onClick={() => changeFilter(today, shift)}>Hari ini</Button>}</div>{!isKaryawan && <div className="flex flex-wrap gap-2" aria-label="Filter shift">{[{ value: null, label: 'Semua shift' }, { value: 'siang', label: 'Siang' }, { value: 'malam', label: 'Malam' }].map((item) => <Button key={item.label} variant={shift === item.value ? 'default' : 'outline'} aria-pressed={shift === item.value} onClick={() => changeFilter(date, item.value)} className="rounded-full">{item.label}</Button>)}</div>}</div>}

    {!isKaryawan && <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl border bg-primary/5 p-4"><p className="text-xs text-muted-foreground">Omzet</p><p className="mt-1 break-words text-lg font-bold text-primary">{formatRupiah(summary.totalRevenue + summary.serviceRevenue)}</p></div><div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Profit</p><p className="mt-1 break-words text-lg font-bold">{formatRupiah(summary.totalProfit + summary.serviceProfit)}</p></div><div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card px-4 py-3 text-sm"><span className="text-muted-foreground">Pengeluaran</span><span className="font-semibold text-orange-600 dark:text-orange-400">{formatRupiah(summary.totalExpense)}</span></div></div>}

    <section aria-labelledby="record-transaction"><h2 id="record-transaction" className="mb-3 text-sm font-semibold">{isKaryawan ? 'Catat penjualan' : 'Catat transaksi baru'}</h2>{date !== today && <p className="mb-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Riwayat sedang menampilkan {dateLabel}. Transaksi baru tetap dicatat untuk hari ini.</p>}<div className="space-y-2"><QuickSale products={products} userId={userId} />{!isKaryawan && <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2"><WorkEntry kind="admin" /><WorkEntry kind="expense" /></div>}</div></section>

    <section aria-labelledby="activity"><div className="mb-3 flex items-center justify-between"><h2 id="activity" className="text-sm font-semibold">{date === today ? 'Aktivitas hari ini' : 'Aktivitas pada tanggal ini'}</h2><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{activity.length} catatan</span></div>
      {activity.length ? <div className="divide-y rounded-2xl border bg-card px-4">{activity.map((item) => {
        const Icon = item.type === 'sale' ? ShoppingBag : item.type === 'service' ? Wallet : Receipt;
        return <div key={item.key} className="flex items-start gap-3 py-4"><span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', item.type === 'expense' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-primary/10 text-primary')}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-1.5"><span className="text-[11px] text-muted-foreground">{item.subtitle}</span><ShiftBadge userShift={item.userShift} userName={item.userName} /></div><p className="break-words text-sm font-medium leading-relaxed">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTimeID(item.date)}</p>{!isKaryawan && <p className={cn('mt-2 text-sm font-semibold', item.type === 'expense' ? 'text-orange-600 dark:text-orange-400' : 'text-primary')}>{item.type === 'expense' ? '− ' : ''}{formatRupiah(item.amount)}</p>}</div></div>;
      })}</div> : <div className="rounded-2xl border border-dashed p-8 text-center"><History className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" /><p className="text-sm font-semibold">Belum ada catatan</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{date === today ? isKaryawan ? 'Catat penjualan pertama di atas.' : 'Catat transaksi pertama di atas.' : 'Pilih tanggal lain untuk melihat aktivitas toko.'}</p></div>}
    </section>
          {isKaryawan && <FinishShift hasClosingStockCheck={hasClosingStockCheck} shiftCash={shiftCash} />}
  </div>;
}
