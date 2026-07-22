'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Search, AlertCircle, CheckCircle2, X, TrendingUp } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';

type Product = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  provider: string | null;
  validity: string | null;
  locationId: number | null;
  locationName: string | null;
  stock: number;
  costPrice: number;
  sellPrice: number;
};

type Location = { id: number; name: string; sortOrder: number };

type Props = {
  isKaryawan: boolean;
  products: Product[];
  locations: Location[];
};

export function HargaClient({ isKaryawan, products, locations }: Props) {
  const [q, setQ] = React.useState('');
  const [activeCat, setActiveCat] = React.useState<number | 'all'>('all');
  const [activeLoc, setActiveLoc] = React.useState<number | 'all'>('all');
  const [onlyOut, setOnlyOut] = React.useState(false);

  // Auto-suggestion: kalau ketik "rak" → tampil lokasi yang mengandung kata tsb
  const [locSuggest, setLocSuggest] = React.useState(false);
  const trimmed = q.trim().toLowerCase();
  const isLocSearch = ['rak', 'toples', 'etalase', 'gudang', 'depan', 'samping'].some((k) =>
    trimmed.includes(k)
  );

  const categories = React.useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const p of products) {
      const cur = map.get(p.categoryId);
      if (cur) cur.count++;
      else map.set(p.categoryId, { id: p.categoryId, name: p.categoryName, count: 1 });
    }
    return Array.from(map.values());
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = products;
    if (activeCat !== 'all') list = list.filter((p) => p.categoryId === activeCat);
    if (activeLoc !== 'all') list = list.filter((p) => p.locationId === activeLoc);
    if (onlyOut) list = list.filter((p) => p.stock <= 0);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          p.categoryName.toLowerCase().includes(s) ||
          (p.provider ?? '').toLowerCase().includes(s) ||
          (p.locationName ?? '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [products, q, activeCat, activeLoc, onlyOut]);

  // Group by lokasi (urut sesuai sortOrder location)
  const groupedByLocation = React.useMemo(() => {
    const map = new Map<number, Product[]>();
    for (const p of filtered) {
      const lid = p.locationId ?? -1;
      const arr = map.get(lid) ?? [];
      arr.push(p);
      map.set(lid, arr);
    }
    const out: { location: Location | null; locationLabel: string; items: Product[] }[] = [];
    for (const loc of locations) {
      if (map.has(loc.id)) {
        out.push({ location: loc, locationLabel: loc.name, items: map.get(loc.id)! });
      }
    }
    if (map.has(-1)) {
      out.push({ location: null, locationLabel: 'Tanpa Lokasi', items: map.get(-1)! });
    }
    return out;
  }, [filtered, locations]);

  // Per lokasi: hitung barang habis (untuk counter di chip)
  const locStats = React.useMemo(() => {
    const m = new Map<number, { total: number; out: number }>();
    for (const p of products) {
      if (p.locationId == null) continue;
      const cur = m.get(p.locationId) ?? { total: 0, out: 0 };
      cur.total++;
      if (p.stock <= 0) cur.out++;
      m.set(p.locationId, cur);
    }
    return m;
  }, [products]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Cek Barang & Harga</h1>
        <p className="text-xs text-muted-foreground">
          Cari barang → lihat harga &amp; lokasi penyimpanan
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder='Cari barang... mis. "Surya", "rak 1", "toples"'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setLocSuggest(true)}
          onBlur={() => setTimeout(() => setLocSuggest(false), 200)}
          className="pl-9 pr-9"
          autoFocus
        />
        {q && (
          <button
            onClick={() => setQ('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Auto-suggestion lokasi berdasarkan kata kunci */}
      {isLocSearch && locSuggest && (
        <div className="rounded-lg border bg-card p-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">
            Saran lokasi
          </div>
          <div className="flex flex-wrap gap-1.5">
            {locations
              .filter((l) => l.name.toLowerCase().includes(trimmed))
              .map((l) => (
                <Button
                  key={l.id}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActiveLoc(l.id);
                    setLocSuggest(false);
                    setQ('');
                  }}
                  className="h-7 text-xs"
                >
                  <MapPin className="mr-1 h-3 w-3" />
                  {l.name}
                </Button>
              ))}
          </div>
        </div>
      )}

      {/* Category chips */}
      <div>
        <div className="mb-1 text-[10px] uppercase text-muted-foreground">Kategori</div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={activeCat === 'all' ? 'default' : 'outline'}
            onClick={() => setActiveCat('all')}
            className="h-7 text-xs"
          >
            Semua
          </Button>
          {categories.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={activeCat === c.id ? 'default' : 'outline'}
              onClick={() => setActiveCat(c.id)}
              className="h-7 text-xs"
            >
              {c.name} ({c.count})
            </Button>
          ))}
        </div>
      </div>

      {/* Location chips dengan counter barang habis */}
      <div>
        <div className="mb-1 text-[10px] uppercase text-muted-foreground">Lokasi</div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={activeLoc === 'all' ? 'default' : 'outline'}
            onClick={() => setActiveLoc('all')}
            className="h-7 text-xs"
          >
            Semua
          </Button>
          {locations.map((l) => {
            const stats = locStats.get(l.id);
            if (!stats) return null;
            return (
              <Button
                key={l.id}
                size="sm"
                variant={activeLoc === l.id ? 'default' : 'outline'}
                onClick={() => setActiveLoc(l.id)}
                className="h-7 text-xs"
              >
                <MapPin className="mr-1 h-3 w-3" />
                {l.name} ({stats.total}
                {stats.out > 0 && <span className="ml-0.5 text-rose-500">·{stats.out} habis</span>})
              </Button>
            );
          })}
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={onlyOut ? 'default' : 'outline'}
          onClick={() => setOnlyOut(!onlyOut)}
          className="h-7 text-xs"
        >
          <AlertCircle className="mr-1 h-3 w-3" />
          {onlyOut ? 'Semua' : 'Hanya stok habis'}
        </Button>
        {(activeCat !== 'all' || activeLoc !== 'all' || onlyOut || q) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setActiveCat('all');
              setActiveLoc('all');
              setOnlyOut(false);
              setQ('');
            }}
            className="h-7 text-xs"
          >
            Reset filter
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">Tidak ditemukan</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Coba kata kunci lain atau ganti filter
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groupedByLocation.map((group) => (
            <div key={group.location?.id ?? 'none'} className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/30">
                <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {group.locationLabel}
                </h2>
                <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                  ({group.items.length} barang)
                </span>
                {group.items.filter((p) => p.stock <= 0).length > 0 && (
                  <span className="ml-auto rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                    {group.items.filter((p) => p.stock <= 0).length} habis
                  </span>
                )}
              </div>
              {group.items.map((p) => (
                <Card key={p.id} className="ml-2">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          {p.stock > 0 ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                          )}
                          {p.provider && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {p.provider}
                            </span>
                          )}
                          {p.validity && (
                            <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                              {p.validity}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{p.categoryName}</span>
                          {p.stock > 0 ? (
                            <span>· Stok {p.stock}</span>
                          ) : (
                            <span className="text-rose-600">· Stok habis</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                          {formatRupiah(p.sellPrice)}
                        </div>
                        {!isKaryawan && (
                          <div className="text-[10px] text-muted-foreground">
                            Modal {formatRupiah(p.costPrice)}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      <Link href="/harga/update-massal">
        <Button variant="outline" className="w-full">
          <TrendingUp className="mr-2 h-4 w-4" />
          Update Harga Massal (Owner)
        </Button>
      </Link>

      <Link href="/inventory">
        <Button variant="outline" className="w-full">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali ke Inventory
        </Button>
      </Link>
    </div>
  );
}
