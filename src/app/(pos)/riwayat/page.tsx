import { Receipt, Undo2 } from 'lucide-react';
import { requireUser } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { formatRupiah, startOfDay } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

export default async function RiwayatPage() {
  const me = await requireUser();
  const sales = await prisma.saleTransaction.findMany({
    where: { createdAt: { gte: startOfDay() }, ...(me.role === 'karyawan' ? { userId: me.id } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, kind: true, createdAt: true, totalRevenue: true,
      user: { select: { username: true } },
      items: { select: { qty: true, product: { select: { name: true } } } },
    },
  });
  const total = sales.reduce((sum, s) => sum + Number(s.totalRevenue), 0);
  const count = sales.filter((s) => s.kind === 'SALE').length;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-700 to-primary p-5 text-white shadow-lg shadow-primary/20">
        <p className="text-xs font-medium text-emerald-100">{me.role === 'karyawan' ? 'Penjualanmu hari ini' : 'Penjualan hari ini'}</p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatRupiah(total)}</p>
        <p className="mt-1 text-xs text-emerald-100">{count} transaksi</p>
      </div>
      {sales.length ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {sales.map((s) => {
            const isReturn = s.kind === 'RETURN';
            return (
              <li key={s.id} className="flex items-start gap-3 p-4">
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isReturn ? 'bg-orange-500/10 text-orange-600' : 'bg-primary/10 text-primary'}`}>
                  {isReturn ? <Undo2 className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{s.items.map((i) => `${i.product.name} × ${i.qty}`).join(', ')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">#{s.id} • {timeFmt.format(s.createdAt)}{me.role === 'owner' && s.user ? ` • ${s.user.username}` : ''}{isReturn ? ' • Retur' : ''}</p>
                </div>
                <span className={`shrink-0 text-sm font-bold tabular-nums ${isReturn ? 'text-orange-600' : ''}`}>{formatRupiah(Number(s.totalRevenue))}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Receipt className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="font-semibold">Belum ada transaksi hari ini</p>
          <p className="mt-1 text-sm text-muted-foreground">Penjualan yang dicatat dari Kasir akan muncul di sini.</p>
        </div>
      )}
    </div>
  );
}
