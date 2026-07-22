'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatRupiah } from '@/lib/utils';

type Product = {
  id: number;
  name: string;
  categoryName: string;
  sellPrice: number | bigint;
  stock: number;
};

export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  React.useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const j = await r.json();
          setResults(j.items ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Cari produk...</span>
        <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[10px] font-mono sm:inline">
          Ctrl+K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <div className="flex items-center gap-2 border-b pb-3">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ketik nama barang (mis. A16, TG, Pulsa)..."
              className="border-0 px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {q.trim() === '' ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Ketik untuk mencari produk di semua kategori
              </div>
            ) : loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Mencari...</div>
            ) : results.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Produk tidak ditemukan
              </div>
            ) : (
              <div className="space-y-1">
                {results.map((p) => (
                  <Link
                    key={p.id}
                    href={`/inventory/product/${p.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-lg p-3 hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.categoryName} • Stok: {p.stock}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold">
                      {formatRupiah(p.sellPrice)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
