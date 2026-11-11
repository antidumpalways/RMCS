'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Plus, Minus, ShoppingCart, Trash2, Loader2, CheckCircle2, Package, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProductThumb } from '@/components/pos/product-thumb';
import { usePos } from '@/components/pos/pos-provider';
import { recordCartSale } from '@/lib/actions';
import { cn, formatRupiah } from '@/lib/utils';
import type { PosProduct } from '@/lib/pos-data';

type Step = 'cart' | 'pay' | 'done';

function cashSuggestions(total: number): number[] {
  if (total <= 0) return [];
  const steps = [5_000, 10_000, 20_000, 50_000, 100_000];
  const out = new Set<number>();
  for (const step of steps) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) out.add(rounded);
  }
  return [...out].slice(0, 4);
}

export function KasirClient() {
  const router = useRouter();
  const { products, popularIds, cart, count, total, add, setQty, clearCart, applySold } = usePos();
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<number | 'all'>('all');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>('cart');
  const [received, setReceived] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [receipt, setReceipt] = React.useState<{ saleId: number; total: number; change: number; items: number } | null>(null);

  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categories = React.useMemo(() => Array.from(new Map(products.map((p) => [p.categoryId, p.categoryName])).entries()), [products]);
  const popularRank = React.useMemo(() => new Map(popularIds.map((id, i) => [id, i])), [popularIds]);

  const visible = React.useMemo(() => {
    const tokens = query.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        if (category !== 'all' && p.categoryId !== category) return false;
        if (!tokens.length) return true;
        const text = `${p.name} ${p.categoryName} ${p.provider ?? ''} ${p.validity ?? ''}`.toLocaleLowerCase('id-ID');
        return tokens.every((t) => text.includes(t));
      })
      .sort((a, b) =>
        Number(b.stock > 0) - Number(a.stock > 0) ||
        (popularRank.get(a.id) ?? 999) - (popularRank.get(b.id) ?? 999));
  }, [products, query, category, popularRank]);

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ id: Number(id), qty, product: byId.get(Number(id)) }))
    .filter((l): l is { id: number; qty: number; product: PosProduct } => !!l.product);

  const receivedNum = Number(received) || 0;
  const change = receivedNum - total;
  const canPay = count > 0 && receivedNum >= total && !pending;

  const openSheet = () => { setError(''); setStep('cart'); setReceived(''); setReceipt(null); setSheetOpen(true); };
  const closeSheet = () => { if (pendingRef.current) return; setSheetOpen(false); if (step === 'done') { setStep('cart'); setReceipt(null); } };

  const pay = async () => {
    if (pendingRef.current || !canPay) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      const sold = lines.map((l) => ({ id: l.id, qty: l.qty }));
      const result = await recordCartSale(sold.map((l) => ({ productId: l.id, qty: l.qty })));
      if ('error' in result && result.error) { setError(result.error); return; }
      setReceipt({ saleId: result.saleId!, total, change, items: count });
      applySold(sold);
      clearCart();
      setStep('done');
      router.refresh(); // sinkronkan stok dari server tanpa menunggu
    } catch {
      setError('Belum berhasil menyimpan. Periksa koneksi lalu coba lagi.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 space-y-3 border-b bg-background/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" />
          <input
            type="search"
            inputMode="search"
            aria-label="Cari produk"
            placeholder="Cari produk, voucher, aksesori..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 w-full rounded-2xl border bg-card pl-11 pr-11 text-base shadow-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button aria-label="Hapus pencarian" onClick={() => setQuery('')} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Kategori">
          {([['all', 'Semua'] as const, ...categories.map(([id, name]) => [id, name] as const)]).map(([id, name]) => (
            <button
              key={String(id)}
              role="tab"
              aria-selected={category === id}
              onClick={() => setCategory(id)}
              className={cn('min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors active:scale-95', category === id ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-card text-foreground/80')}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 pb-28">
        {visible.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visible.map((p) => {
              const qty = cart[p.id] ?? 0;
              const out = p.stock <= 0;
              const sub = [p.provider, p.validity].filter(Boolean).join(' · ');
              return (
                <div key={p.id} className={cn('relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow', qty > 0 && 'border-primary ring-2 ring-primary/25', out && 'opacity-55')}>
                  <button
                    disabled={out || qty >= p.stock}
                    onClick={() => add(p.id)}
                    aria-label={`Tambah ${p.name}${sub ? ` ${sub}` : ''}`}
                    className="flex flex-1 flex-col text-left transition-transform active:scale-[0.98] disabled:active:scale-100"
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                      <ProductThumb name={p.name} seed={p.categoryId} />
                      {qty > 0 && <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground shadow">{qty}</span>}
                      {out ? <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[11px] font-semibold text-white">Habis</span>
                        : p.stock <= 3 && <span className="absolute bottom-2 left-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">Sisa {p.stock}</span>}
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5 p-3 pb-2">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</p>
                      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
                      <p className="mt-auto pt-1 text-base font-bold tabular-nums text-primary">{formatRupiah(p.sellPrice)}</p>
                    </div>
                  </button>
                  <div className="px-3 pb-3">
                    {qty > 0 ? (
                      <div className="flex h-10 items-center justify-between rounded-xl bg-primary/10">
                        <button aria-label={`Kurangi ${p.name}`} onClick={() => setQty(p.id, qty - 1)} className="flex h-10 w-11 items-center justify-center text-primary active:scale-90"><Minus className="h-4 w-4" /></button>
                        <span className="text-sm font-bold tabular-nums" aria-live="polite">{qty}</span>
                        <button aria-label={`Tambah ${p.name}`} disabled={qty >= p.stock} onClick={() => add(p.id)} className="flex h-10 w-11 items-center justify-center text-primary active:scale-90 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <button disabled={out} onClick={() => add(p.id)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground transition-transform active:scale-95 disabled:opacity-50">
                        <Plus className="h-4 w-4" /> Tambah
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-16 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="font-semibold">Produk tidak ditemukan</p>
            <p className="mt-1 text-sm text-muted-foreground">Coba kata lain atau pilih kategori Semua.</p>
          </div>
        )}
      </div>

      {count > 0 && !sheetOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 pb-3">
          <button
            onClick={openSheet}
            className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl bg-primary p-3 pl-4 text-primary-foreground shadow-xl shadow-primary/30 transition-transform active:scale-[0.98] animate-in slide-in-from-bottom-4 duration-200"
          >
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-xs font-medium opacity-85">Keranjang • {count} item</span>
              <span className="block text-lg font-bold leading-tight tabular-nums">{formatRupiah(total)}</span>
            </span>
            <span className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-primary">Bayar</span>
          </button>
        </div>
      )}

      <Dialog open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          {step === 'cart' && (
            <>
              <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-5">
                <DialogTitle>Keranjang • {count} item</DialogTitle>
                <DialogDescription>Cek barang dan jumlahnya sebelum bayar.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4">
                {lines.length ? lines.map(({ id, qty, product: p }) => (
                  <div key={id} className="flex items-center gap-3 rounded-2xl border p-2.5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl"><ProductThumb name={p.name} seed={p.categoryId} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{formatRupiah(p.sellPrice)} × {qty}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-sm font-bold tabular-nums">{formatRupiah(p.sellPrice * qty)}</span>
                      <div className="flex items-center rounded-lg bg-muted">
                        <button aria-label={qty === 1 ? `Hapus ${p.name}` : `Kurangi ${p.name}`} onClick={() => setQty(id, qty - 1)} className="flex h-9 w-9 items-center justify-center text-muted-foreground active:scale-90">{qty === 1 ? <Trash2 className="h-4 w-4 text-destructive" /> : <Minus className="h-4 w-4" />}</button>
                        <span className="w-6 text-center text-sm font-bold tabular-nums">{qty}</span>
                        <button aria-label={`Tambah ${p.name}`} disabled={qty >= p.stock} onClick={() => add(id)} className="flex h-9 w-9 items-center justify-center text-muted-foreground active:scale-90 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                )) : <p className="py-10 text-center text-sm text-muted-foreground">Keranjang kosong.</p>}
              </div>
              <div className="shrink-0 space-y-3 border-t p-4">
                <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Total</span><span className="text-2xl font-extrabold tabular-nums">{formatRupiah(total)}</span></div>
                <Button size="lg" className="w-full rounded-xl" disabled={!count} onClick={() => { setReceived(''); setStep('pay'); }}>Lanjut ke pembayaran</Button>
                {count > 0 && <button onClick={() => { clearCart(); setSheetOpen(false); }} className="w-full py-1 text-sm font-medium text-muted-foreground">Kosongkan keranjang</button>}
              </div>
            </>
          )}

          {step === 'pay' && (
            <>
              <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-5">
                <DialogTitle>Pembayaran</DialogTitle>
                <DialogDescription>Masukkan uang yang diterima dari pelanggan.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
                <div className="rounded-2xl bg-muted/60 p-4 text-center">
                  <p className="text-xs font-medium text-muted-foreground">Total tagihan • {count} item</p>
                  <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatRupiah(total)}</p>
                </div>
                <div>
                  <label htmlFor="uang-diterima" className="mb-1.5 block text-sm font-semibold">Uang diterima</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">Rp</span>
                    <input
                      id="uang-diterima"
                      inputMode="numeric"
                      autoFocus
                      placeholder="0"
                      value={received ? Number(received).toLocaleString('id-ID') : ''}
                      onChange={(e) => setReceived(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      className="h-14 w-full rounded-2xl border bg-card pl-12 pr-4 text-right text-2xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button onClick={() => setReceived(String(total))} className="min-h-10 rounded-full border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-primary active:scale-95">Uang pas</button>
                    {cashSuggestions(total).map((n) => (
                      <button key={n} onClick={() => setReceived(String(n))} className="min-h-10 rounded-full border bg-card px-4 text-sm font-semibold tabular-nums active:scale-95">{n.toLocaleString('id-ID')}</button>
                    ))}
                  </div>
                </div>
                <div className={cn('rounded-2xl p-4 text-center transition-colors', !received ? 'bg-muted/50' : change >= 0 ? 'bg-emerald-500/10' : 'bg-destructive/10')}>
                  <p className="text-xs font-medium text-muted-foreground">{!received || change >= 0 ? 'Kembalian' : 'Uang kurang'}</p>
                  <p className={cn('mt-1 text-3xl font-extrabold tabular-nums', !received ? 'text-muted-foreground' : change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                    {!received ? '—' : formatRupiah(Math.abs(change))}
                  </p>
                </div>
                {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
              </div>
              <div className="shrink-0 space-y-2 border-t p-4">
                <Button size="lg" className="w-full rounded-xl" disabled={!canPay} onClick={pay}>
                  {pending ? <><Loader2 className="h-5 w-5 animate-spin" /> Menyimpan...</> : 'Selesaikan transaksi'}
                </Button>
                <button disabled={pending} onClick={() => setStep('cart')} className="flex w-full items-center justify-center gap-1 py-1 text-sm font-medium text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Kembali ke keranjang</button>
              </div>
            </>
          )}

          {step === 'done' && receipt && (
            <div className="flex flex-col items-center gap-4 p-6 pt-10 text-center animate-in zoom-in-95 duration-200">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600"><CheckCircle2 className="h-12 w-12" /></span>
              <div>
                <h2 className="text-xl font-bold">Transaksi berhasil</h2>
                <p className="mt-1 text-sm text-muted-foreground">Penjualan #{receipt.saleId} • {receipt.items} item • {formatRupiah(receipt.total)}</p>
              </div>
              <div className="w-full rounded-2xl bg-emerald-500/10 p-4">
                <p className="text-xs font-medium text-muted-foreground">Kembalian</p>
                <p className="mt-1 text-4xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">{formatRupiah(receipt.change)}</p>
              </div>
              <Button size="lg" className="w-full rounded-xl" onClick={() => { setSheetOpen(false); setStep('cart'); setReceipt(null); setQuery(''); }}>Transaksi baru</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
