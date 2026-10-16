'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Moon, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { recordShiftStockCheck } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';

type Product = {
  id: number;
  name: string;
  categoryName: string;
  locationName: string | null;
  systemStock: number;
};

type Phase = 'buka' | 'tutup' | null;

export function CekStokClient({ phase, products }: { phase: Phase; products: Product[] }) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = React.useState('');
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<{ checkedCount: number; changedCount: number } | null>(null);
  const filledCount = Object.values(counts).filter((value) => value !== '').length;
  const filtered = products.filter((product) =>
    `${product.name} ${product.categoryName} ${product.locationName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  if (!phase) {
    return <div className="space-y-5">
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Beranda</Link>
      <div><p className="mb-1 text-xs font-medium text-primary">CATATAN STOK</p><h1 className="text-2xl font-bold tracking-tight">Cek Stok</h1><p className="mt-1 text-sm text-muted-foreground">Pilih waktu, lalu cocokkan jumlah barang dengan catatan manual.</p></div>
      <div className="grid gap-3">
        <Link href="/cek-stok?mode=buka" className="flex min-h-24 items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600"><Sun className="h-6 w-6" /></span>
          <span><span className="block text-base font-semibold">Saat buka toko</span><span className="mt-1 block text-sm text-muted-foreground">Catat stok sebelum mulai melayani.</span></span>
        </Link>
        <Link href="/cek-stok?mode=tutup" className="flex min-h-24 items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600"><Moon className="h-6 w-6" /></span>
          <span><span className="block text-base font-semibold">Saat tutup toko</span><span className="mt-1 block text-sm text-muted-foreground">Catat stok sebelum serah terima shift.</span></span>
        </Link>
      </div>
      <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">Hasil hitung dan selisih akan dikirim ke owner untuk diperiksa. Stok di aplikasi belum berubah.</p>
    </div>;
  }

  const isOpening = phase === 'buka';
  const save = async () => {
    const entered = Object.entries(counts)
      .filter(([, value]) => value !== '')
      .map(([id, value]) => ({ productId: Number(id), physicalStock: Number(value) }));
    if (!entered.length || pending) return;
    setPending(true);
    setError('');
    try {
      const saved = await recordShiftStockCheck({ phase, counts: entered });
      setResult({ checkedCount: saved.checkedCount, changedCount: saved.changedCount });
      setCounts({});
      toast({ title: 'Hasil cek stok tersimpan', description: saved.changedCount ? `${saved.changedCount} barang memiliki selisih untuk diperiksa owner.` : 'Tidak ada selisih dari stok aplikasi.' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message || 'Belum berhasil menyimpan. Silakan coba lagi.');
    } finally {
      setPending(false);
    }
  };

  return <div className="space-y-4">
    <Link href="/cek-stok" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Pilih waktu cek</Link>
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isOpening ? 'bg-amber-500/10 text-amber-600' : 'bg-indigo-500/10 text-indigo-600'}`}>{isOpening ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</span>
      <div><p className="text-xs font-medium text-primary">CEK STOK {isOpening ? 'SAAT BUKA' : 'SAAT TUTUP'}</p><h1 className="text-xl font-bold">Cocokkan dengan catatan manual</h1><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Masukkan jumlah yang benar-benar dihitung. Barang yang belum diisi tidak disimpan.</p></div>
    </div>

    {result && <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{result.checkedCount} barang tercatat. {result.changedCount ? `${result.changedCount} barang ada selisih dan menunggu owner.` : 'Tidak ada selisih.'} Stok aplikasi belum diubah.</span></div>}

    <div className="sticky top-[108px] z-20 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:p-0 sm:bg-transparent">
      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama barang..." className="pl-9" aria-label="Cari nama barang" /></div>
      <p className="px-1 text-xs text-muted-foreground">Sudah diisi: {filledCount} dari {products.length} barang</p>
    </div>

    <div className="space-y-2">
      {filtered.map((product) => <Card key={product.id}><CardContent className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-snug">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.categoryName}{product.locationName ? ` · ${product.locationName}` : ''}</p><p className="mt-1 text-xs">Stok aplikasi: <strong>{product.systemStock}</strong></p></div>
        <label className="w-24 shrink-0"><span className="mb-1 block text-[10px] font-medium text-muted-foreground">Hitung fisik</span><Input type="number" inputMode="numeric" min={0} max={1_000_000} step={1} value={counts[product.id] ?? ''} onChange={(event) => { const value = event.target.value.replace(/\D/g, ''); setCounts((current) => ({ ...current, [product.id]: value })); }} placeholder="Jumlah" aria-label={`Hasil hitung ${product.name}`} /></label>
      </CardContent></Card>)}
      {filtered.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Barang tidak ditemukan. Coba kata pencarian lain.</div>}
    </div>

    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="sticky bottom-16 z-20 -mx-4 border-t bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
      <Button type="button" size="lg" className="w-full rounded-xl" disabled={!filledCount || pending} onClick={save}>{pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><ClipboardCheck className="h-4 w-4" /> Simpan {filledCount ? `${filledCount} hasil hitung` : 'hasil hitung'}</>}</Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">Selisih disimpan untuk owner. Stok aplikasi tidak langsung berubah.</p>
    </div>
  </div>;
}
