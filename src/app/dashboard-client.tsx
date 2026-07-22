'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Wallet,
  CreditCard,
  PiggyBank,
  Boxes,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShoppingBag,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSummary } from '@/lib/automation';
import Link from 'next/link';

type Props = {
  data: DashboardSummary;
  isKaryawan: boolean;
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  accent?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className={`mt-1 truncate text-xl font-bold ${accent ?? ''}`}>{value}</div>
            {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MaskedValue({ isKaryawan, value }: { isKaryawan: boolean; value: number | bigint }) {
  if (!isKaryawan) return <>{formatRupiah(value)}</>;
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      Rp •••••••
    </span>
  );
}

export function DashboardClient({ data, isKaryawan }: Props) {
  const totalSaldo = data.cash + data.totalSaldo;

  const chartData = data.grafikPenjualan.map((g) => ({
    date: g.date,
    Revenue: Number(g.revenue),
    Profit: Number(g.profit),
  }));

  const hasOut = data.produkHabis > 0;
  const hasLow = data.produkMenipis > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-xs text-muted-foreground">Read-only • Otomatis dihitung sistem</p>
      </div>

      {/* ALERT STOK - tampil untuk semua role (info operasional) */}
      {(hasOut || hasLow) && (
        <Link href="/inventory">
          <Card
            className={
              hasOut
                ? 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 cursor-pointer transition-colors hover:bg-rose-100'
                : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 cursor-pointer transition-colors hover:bg-amber-100'
            }
          >
            <CardContent className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={
                    hasOut
                      ? 'h-5 w-5 text-rose-600 dark:text-rose-400'
                      : 'h-5 w-5 text-amber-600 dark:text-amber-400'
                  }
                />
                <div>
                  <div
                    className={
                      hasOut
                        ? 'text-sm font-bold text-rose-700 dark:text-rose-300'
                        : 'text-sm font-bold text-amber-700 dark:text-amber-300'
                    }
                  >
                    {hasOut
                      ? `${data.produkHabis} produk HABIS — restock sekarang`
                      : `${data.produkMenipis} produk hampir habis`}
                  </div>
                  {hasOut && hasLow && (
                    <div className="text-[10px] text-rose-600/80 dark:text-rose-400/80">
                      + {data.produkMenipis} lagi menipis
                    </div>
                  )}
                </div>
              </div>
              <span
                className={
                  hasOut
                    ? 'rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-bold text-white'
                    : 'rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-bold text-white'
                }
              >
                Lihat →
              </span>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Row 1: Modal / Cash / Saldo / Inventory */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Wallet}
          label="Total Modal"
          value={<MaskedValue isKaryawan={isKaryawan} value={data.totalModal} />}
          hint="Modal seluruh stok"
        />
        <StatCard
          icon={PiggyBank}
          label="Cash"
          value={<MaskedValue isKaryawan={isKaryawan} value={data.cash} />}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          icon={CreditCard}
          label="Total Saldo"
          value={<MaskedValue isKaryawan={isKaryawan} value={totalSaldo} />}
          hint="Cash + Saldo Awal"
          accent="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          icon={Boxes}
          label="Nilai Inventory"
          value={<MaskedValue isKaryawan={isKaryawan} value={data.inventoryValue} />}
          hint="Harga jual × stok"
        />
      </div>

      {/* Row 2: Omzet & Profit Hari */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Omzet Hari Ini
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              <MaskedValue isKaryawan={isKaryawan} value={data.omzetHari} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5 rotate-180" />
              Profit Hari Ini
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              <MaskedValue isKaryawan={isKaryawan} value={data.profitHari} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grafik 7 hari */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Grafik Penjualan (7 Hari)</CardTitle>
        </CardHeader>
        <CardContent>
          {isKaryawan ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-lg bg-muted text-center text-sm text-muted-foreground">
              Disembunyikan untuk mode karyawan
            </div>
          ) : chartData.every((d) => d.Revenue === 0) ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <ShoppingBag className="mb-2 h-8 w-8 opacity-40" />
              Belum ada transaksi
            </div>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}jt`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}rb`;
                      return String(v);
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => formatRupiah(v)}
                  />
                  <Bar dataKey="Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stok Menipis / Habis */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className={
                hasOut
                  ? 'h-4 w-4 text-rose-500'
                  : 'h-4 w-4 text-amber-500'
              }
            />
            {hasOut ? 'Stok Habis & Menipis' : 'Stok Menipis'}
          </CardTitle>
          {data.produkHampirHabis.length > 0 && (
            <Link href="/inventory" className="text-xs text-primary">
              Lihat semua ({data.produkHampirHabis.length})
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {data.produkHampirHabis.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-4 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <div className="text-sm text-muted-foreground">Semua stok aman ✓</div>
            </div>
          ) : (
            <div className="space-y-1">
              {data.produkHampirHabis.map((p) => {
                const isOut = p.stock === 0;
                return (
                  <Link
                    key={p.id}
                    href={`/inventory/product/${p.id}`}
                    className="flex items-center justify-between rounded-lg p-2.5 hover:bg-muted"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isOut ? (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      )}
                      <span className="truncate text-sm">{p.name}</span>
                    </div>
                    <span
                      className={
                        isOut
                          ? 'ml-2 shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                          : 'ml-2 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      }
                    >
                      {isOut ? 'HABIS' : `Sisa ${p.stock}`}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
