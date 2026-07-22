'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { TrendingUp, TrendingDown, Package, Award, FolderTree, Receipt, Boxes, Calendar, FileText } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import type { ReportData } from '@/lib/automation';

type Props = {
  isKaryawan: boolean;
  from: string;
  to: string;
  data: ReportData;
};

export function LaporanClient({ isKaryawan, from, to, data }: Props) {
  const router = useRouter();

  if (isKaryawan) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">Laporan</h1>
          <p className="text-xs text-muted-foreground">Tidak tersedia untuk mode karyawan</p>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Laporan hanya dapat dilihat oleh admin/owner.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Laporan</h1>
        <p className="text-xs text-muted-foreground">Otomatis • Filter tanggal</p>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-end gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Dari</Label>
                <Input
                  type="date"
                  defaultValue={from}
                  onChange={(e) => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('from', e.target.value);
                    router.push(url.toString());
                  }}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Sampai</Label>
                <Input
                  type="date"
                  defaultValue={to}
                  onChange={(e) => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('to', e.target.value);
                    router.push(url.toString());
                  }}
                  className="h-9"
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/laporan')}
            >
              Bulan ini
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatBox icon={TrendingUp} label="Omzet Hari Ini" value={data.omzetHari} accent="emerald" />
        <StatBox icon={TrendingDown} label="Profit Hari Ini" value={data.profitHari} accent="emerald" />
        <StatBox icon={TrendingUp} label="Omzet Bulanan" value={data.omzetBulan} accent="emerald" />
        <StatBox icon={TrendingDown} label="Profit Bulanan" value={data.profitBulan} accent="emerald" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-4 w-4" /> Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Row label="Total Stok (unit)" value={formatRupiah(data.stokTotal).replace('Rp', '')} />
          <Row label="Nilai Modal" value={formatRupiah(data.nilaiModal)} />
          <Row label="Nilai Jual (Inventory)" value={formatRupiah(data.nilaiInventory)} />
          <div className="border-t pt-2">
            <Row
              label="Keuntungan Potensial"
              value={formatRupiah(data.potentialProfit)}
              highlight="emerald"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Pengeluaran Bulan Ini
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Total" value={formatRupiah(data.totalExpenseBulan)} highlight="destructive" />
        </CardContent>
      </Card>

      <ListCard
        icon={Award}
        title="Produk Terlaris (sesuai filter)"
        empty="Belum ada penjualan"
        items={data.produkTerlaris.map((p) => ({
          name: p.name,
          right: (
            <div className="text-right">
              <div className="text-sm font-bold">{p.qty} unit</div>
              <div className="text-[10px] text-muted-foreground">
                {formatRupiah(p.revenue)}
              </div>
            </div>
          ),
        }))}
      />

      <ListCard
        icon={FolderTree}
        title="Kategori Terlaris (sesuai filter)"
        empty="Belum ada penjualan"
        items={data.kategoriTerlaris.map((c) => ({
          name: c.name,
          right: (
            <div className="text-right">
              <div className="text-sm font-bold">{c.qty} unit</div>
              <div className="text-[10px] text-muted-foreground">
                {formatRupiah(c.revenue)}
              </div>
            </div>
          ),
        }))}
      />
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | bigint;
  accent: 'emerald' | 'rose';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div
          className={`mt-1 text-lg font-bold ${
            accent === 'emerald'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {formatRupiah(value)}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'emerald' | 'destructive';
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          highlight === 'emerald'
            ? 'font-bold text-emerald-600 dark:text-emerald-400'
            : highlight === 'destructive'
              ? 'font-bold text-rose-600 dark:text-rose-400'
              : 'font-semibold'
        }
      >
        {value}
      </span>
    </div>
  );
}

function ListCard({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: { name: string; right: React.ReactNode }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <div className="space-y-1">
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between rounded-md p-2 hover:bg-muted/40">
                <span className="truncate text-sm">{it.name}</span>
                {it.right}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
