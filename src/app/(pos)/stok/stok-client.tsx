'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search, X, ClipboardCheck, Package } from 'lucide-react';
import { usePos } from '@/components/pos/pos-provider';
import { ProductThumb } from '@/components/pos/product-thumb';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'low' | 'out';

export function StokClient() {
  const { products } = usePos();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');

  const out = products.filter((p) => p.stock <= 0).length;
  const low = products.filter((p) => p.stock > 0 && p.stock <= 3).length;

  const visible = React.useMemo(() => {
    const tokens = query.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
    return products.filter((p) => {
      if (filter === 'out' && p.stock > 0) return false;
      if (filter === 'low' && !(p.stock > 0 && p.stock <= 3)) return false;
      const text = `${p.name} ${p.categoryName} ${p.provider ?? ''} ${p.validity ?? ''}`.toLocaleLowerCase('id-ID');
      return tokens.every((t) => text.includes(t));
    }).slice(0, 200);
  }, [products, query, filter]);

  return (
    <div className="space-y-3 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" />
        <input type="search" aria-label="Cari stok" placeholder="Cari barang..." value={query} onChange={(e) => setQuery(e.target.value)}
          className="h-12 w-full rounded-2xl border bg-card pl-11 pr-11 text-base shadow-sm outline-none focus:ring-2 focus:ring-ring" />
        {query && <button aria-label="Hapus pencarian" onClick={() => setQuery('')} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground"><X className="h-4 w-4" /></button>}
      </div>
      <div className="flex gap-2">
        {([['all', `Semua (${products.length})`], ['low', `Menipis (${low})`], ['out', `Habis (${out})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={cn('min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors active:scale-95', filter === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{label}</button>
        ))}
      </div>
      <Link href="/cek-stok" className="flex min-h-14 items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary">
        <ClipboardCheck className="h-5 w-5" /> Cek stok buka / tutup shift
      </Link>
      {visible.length ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {visible.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl"><ProductThumb name={p.name} seed={p.categoryId} /></div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[p.categoryName, p.provider, p.validity].filter(Boolean).join(' · ')}</p>
              </div>
              <span className={cn('min-w-12 rounded-full px-3 py-1 text-center text-sm font-bold tabular-nums', p.stock <= 0 ? 'bg-destructive/10 text-destructive' : p.stock <= 3 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-primary/10 text-primary')}>{p.stock}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-14 text-center"><Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-semibold">Tidak ada barang</p></div>
      )}
    </div>
  );
}
