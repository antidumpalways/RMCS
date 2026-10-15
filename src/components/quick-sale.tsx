'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Minus, ShoppingBag, ArrowLeft, ArrowRight, Star, Trash2, Loader2, Package, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn, formatRupiah } from '@/lib/utils';
import { recordCartSale } from '@/lib/actions';

export type SaleProduct = {
  id: number;
  name: string;
  stock: number;
  sellPrice: number;
  categoryId: number;
  categoryName: string;
  provider: string | null;
  validity: string | null;
};

export function QuickSale({ products, popularIds = [], userId, home = false }: {
  products: SaleProduct[];
  popularIds?: number[];
  userId: number;
  home?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [review, setReview] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<number | 'all'>('all');
  const [cart, setCart] = React.useState<Record<number, number>>({});
  const [favorites, setFavorites] = React.useState<number[]>([]);
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const storageKey = `rcms-favorites-${userId}`;

  React.useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      setFavorites(Array.isArray(stored) ? stored.filter((id): id is number => Number.isSafeInteger(id)) : []);
    } catch { setFavorites([]); }
  }, [storageKey]);

  const toggleFavorite = (id: number) => {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional device preference. */ }
  };
  const categories = Array.from(new Map(products.map((p) => [p.categoryId, p.categoryName])).entries());
  const available = products.filter((p) => p.stock > 0);
  const shortcuts = [...new Set([...favorites, ...popularIds, ...available.map((p) => p.id)])]
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is SaleProduct => !!p && p.stock > 0).slice(0, 6);
  const tokens = query.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
  const filtered = products.filter((p) => {
    const text = `${p.name} ${p.categoryName} ${p.provider ?? ''} ${p.validity ?? ''}`.toLocaleLowerCase('id-ID');
    return (category === 'all' || p.categoryId === category) && tokens.every((word) => text.includes(word));
  }).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const lines = Object.entries(cart).map(([id, qty]) => ({ product: products.find((p) => p.id === Number(id)), qty, id: Number(id) }));
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const total = lines.reduce((sum, line) => sum + (line.product?.sellPrice ?? 0) * line.qty, 0);
  const invalid = lines.some((line) => !line.product || line.qty > line.product.stock);
  const changeQty = (id: number, qty: number) => {
    if (pendingRef.current) return;
    setError('');
    setCart((current) => {
      const next = { ...current };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };
  const add = (p: SaleProduct) => {
    if (p.stock > (cart[p.id] ?? 0)) changeQty(p.id, (cart[p.id] ?? 0) + 1);
  };
  const save = async () => {
    if (pendingRef.current || !count || invalid) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const result = await recordCartSale(lines.map((line) => ({ productId: line.id, qty: line.qty })));
      if (result.error) { setError(result.error); return; }
      toast({ title: `${count} barang sudah dicatat ✓`, description: `Penjualan #${result.saleId} berhasil disimpan.` });
      setCart({});
      setOpen(false);
      setReview(false);
      setQuery('');
      setCategory('all');
      router.refresh();
    } catch {
      setError('Belum berhasil menyimpan. Periksa koneksi, lalu coba lagi.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      {home ? (
        <section className="space-y-4" aria-label="Jual barang">
          <button onClick={() => { setReview(false); setOpen(true); }} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-primary/25 bg-card px-4 text-left shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Search className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold">Mau jual barang apa?</span><span className="block text-xs text-muted-foreground">Cari nama, provider, atau masa aktif</span></span>
            <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
          </button>
          {count > 0 && <Button variant="secondary" className="w-full" onClick={() => { setReview(true); setOpen(true); }}><ShoppingBag className="h-4 w-4" /> Lanjutkan pesanan · {count} barang</Button>}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{favorites.length ? 'Favorit & pilihan cepat' : popularIds.length ? 'Sering dijual' : 'Pilih cepat'}</h2><span className="text-xs text-muted-foreground">Tap untuk tambah</span></div>
            {shortcuts.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shortcuts.map((p) => <button key={p.id} onClick={() => { add(p); setReview(false); setOpen(true); }} className="flex min-h-28 min-w-0 flex-col items-start justify-between gap-2 rounded-2xl border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98]">
                <span className="line-clamp-2 text-sm font-medium">{p.name}{p.validity ? ` · ${p.validity}` : ''}</span>
                <span className="flex w-full items-end justify-between gap-1"><span className="text-xs font-semibold text-primary">{formatRupiah(p.sellPrice)}</span><Plus className="h-4 w-4 shrink-0 text-primary" /></span>
              </button>)}
            </div> : <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Belum ada stok siap jual. Tambahkan barang masuk melalui menu Stok.</p>}
          </div>
        </section>
      ) : <Button onClick={() => { setReview(false); setOpen(true); }} className="h-20 w-full flex-col rounded-2xl"><ShoppingBag className="h-5 w-5" /><span>Jual Barang{count > 0 ? ` (${count})` : ''}</span></Button>}

      <Dialog open={open} onOpenChange={(value) => { if (!pendingRef.current) setOpen(value); }}>
        <DialogContent className="flex h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[min(780px,90dvh)] sm:max-w-xl" onOpenAutoFocus={(event) => { event.preventDefault(); if (!review) searchRef.current?.focus(); }}>
          <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 pr-12">
            <DialogTitle>{review ? 'Cek pesanan' : 'Jual Barang'}</DialogTitle>
            <DialogDescription>{review ? 'Pastikan barang dan jumlahnya sudah sesuai.' : 'Cari langsung atau pilih kategori. Bisa beberapa barang sekaligus.'}</DialogDescription>
          </DialogHeader>
          {review ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <Button variant="ghost" onClick={() => setReview(false)} disabled={pending} className="mb-3 -ml-2"><ArrowLeft className="h-4 w-4" /> Tambah barang lain</Button>
            <div className="space-y-3">
              {lines.map(({ product: p, qty, id }) => <div key={id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold">{p?.name ?? 'Barang tidak tersedia'}</p><p className="mt-1 text-xs text-muted-foreground">{[p?.provider, p?.validity].filter(Boolean).join(' · ')}</p><p className="mt-1 text-xs text-muted-foreground">{formatRupiah(p?.sellPrice)} / barang</p></div><Button variant="ghost" size="icon" aria-label={`Hapus ${p?.name ?? 'barang'}`} onClick={() => changeQty(id, 0)} disabled={pending} className="h-11 w-11 shrink-0 text-muted-foreground"><Trash2 className="h-4 w-4" /></Button></div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Kurangi ${p?.name}`} onClick={() => changeQty(id, qty - 1)} disabled={pending}><Minus className="h-4 w-4" /></Button><span className="min-w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">{qty}</span><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Tambah ${p?.name}`} onClick={() => p && add(p)} disabled={pending || !p || qty >= p.stock}><Plus className="h-4 w-4" /></Button></div>
                  <span className="text-sm font-bold tabular-nums">{formatRupiah((p?.sellPrice ?? 0) * qty)}</span>
                </div>
                <p className={cn('mt-2 text-xs', !p || qty > p.stock ? 'text-destructive' : 'text-muted-foreground')}>{p && qty <= p.stock ? `Sisa stok setelah dijual: ${p.stock - qty}` : 'Stok berubah. Kurangi jumlah atau hapus barang ini.'}</p>
              </div>)}
              {!lines.length && <div className="py-10 text-center"><ShoppingBag className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Pesanan masih kosong</p><p className="mt-1 text-sm text-muted-foreground">Kembali untuk memilih barang.</p></div>}
            </div>
          </div> : <>
            <div className="shrink-0 space-y-3 px-4 pt-4">
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" /><Input ref={searchRef} aria-label="Cari barang untuk dijual" placeholder="Contoh: Surya, XL 7 hari..." value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 rounded-xl pl-10 pr-11" />{query && <button aria-label="Hapus pencarian" onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="absolute right-0 top-0 flex h-12 w-11 items-center justify-center text-muted-foreground"><X className="h-4 w-4" /></button>}</div>
              <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Filter kategori"><button onClick={() => setCategory('all')} aria-pressed={category === 'all'} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-xs font-medium', category === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>Semua</button>{categories.map(([id, name]) => <button key={id} onClick={() => setCategory(id)} aria-pressed={category === id} className={cn('min-h-11 shrink-0 rounded-full border px-4 text-xs font-medium', category === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{name}</button>)}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
              <p className="py-2 text-xs text-muted-foreground">{filtered.length} barang · <Star className="inline h-3 w-3" /> untuk simpan favorit</p>
              {filtered.length ? <div className="space-y-2">{filtered.slice(0, 60).map((p) => {
                const selected = cart[p.id] ?? 0;
                return <div key={p.id} className={cn('flex items-center gap-2 rounded-2xl border p-2', selected > 0 && 'border-primary/40 bg-primary/5')}>
                  <button aria-label={`${favorites.includes(p.id) ? 'Hapus dari' : 'Tambah ke'} favorit: ${p.name}`} aria-pressed={favorites.includes(p.id)} onClick={() => toggleFavorite(p.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"><Star className={cn('h-4 w-4', favorites.includes(p.id) && 'fill-amber-400 text-amber-500')} /></button>
                  <div className="min-w-0 flex-1 py-1"><p className="text-sm font-medium leading-snug">{p.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{[p.provider, p.validity].filter(Boolean).join(' · ') || p.categoryName}</p><p className="mt-1 text-xs"><span className="font-semibold text-primary">{formatRupiah(p.sellPrice)}</span><span className="ml-2 text-muted-foreground">{p.stock > 0 ? `Stok ${p.stock}` : 'Habis'}</span></p></div>
                  <Button size="icon" variant={selected ? 'default' : 'secondary'} className="h-11 w-11 shrink-0 rounded-xl" aria-label={`Tambah ${p.name}${p.validity ? ` ${p.validity}` : ''} ke pesanan`} disabled={selected >= p.stock} onClick={() => add(p)}>{selected ? <span className="font-semibold">{selected}<span className="sr-only"> dipilih</span></span> : <Plus className="h-5 w-5" />}</Button>
                </div>;
              })}{filtered.length > 60 && <p className="p-3 text-center text-xs text-muted-foreground">Ketik nama lebih spesifik untuk menemukan barang lainnya.</p>}</div> : <div className="py-12 text-center"><Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Barang belum ditemukan</p><p className="mt-1 text-sm text-muted-foreground">Coba nama lain atau pilih Semua kategori.</p></div>}
            </div>
          </>}
          <div className="shrink-0 space-y-3 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {error && <div role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}<button disabled={pending} onClick={() => router.refresh()} className="mt-2 block min-h-11 font-semibold underline">Perbarui stok</button></div>}
            <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground" aria-live="polite">{count ? `${count} barang · ${lines.length} jenis` : 'Pilih barang untuk memulai'}</span><span className="text-lg font-bold tabular-nums">{formatRupiah(total)}</span></div>
            <Button size="lg" className="w-full rounded-xl" disabled={!count || pending || (review && invalid)} onClick={review ? save : () => { searchRef.current?.blur(); setReview(true); }}>{pending ? <><Loader2 className="h-5 w-5 animate-spin" /> Menyimpan...</> : review ? <><ShoppingBag className="h-5 w-5" /> Catat Penjualan</> : <>Cek Pesanan <ArrowRight className="h-5 w-5" /></>}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
