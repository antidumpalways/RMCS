'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Receipt, ArrowRight, CheckCircle2, Loader2, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { recordBiayaAdmin, recordExpense, closeShift } from '@/lib/actions';
import { formatRupiah } from '@/lib/utils';

export function WorkEntry({ kind }: { kind: 'admin' | 'expense' }) {
  const isAdmin = kind === 'admin';
  const Icon = isAdmin ? Wallet : Receipt;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState('');
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const prefix = React.useId();
  const title = isAdmin ? 'Biaya Admin' : 'Pengeluaran';
  const amountValid = /^\d+$/.test(amount) && Number.isSafeInteger(Number(amount)) && Number(amount) >= (isAdmin ? 0 : 1);
  const valid = amountValid && (isAdmin ? /^\d+$/.test(count) && Number.isSafeInteger(Number(count)) && Number(count) > 0 : !!name.trim());

  return <Dialog open={open} onOpenChange={(value) => { if (!pendingRef.current) { setOpen(value); setError(''); } }}>
    <button onClick={() => setOpen(true)} className="flex min-h-24 w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 active:scale-[0.98]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isAdmin ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{isAdmin ? 'Rekap jasa & top up' : 'Catat uang keluar'}</span></span>
    </button>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{isAdmin ? 'Cukup isi jumlah transaksi jasa dan total biaya admin yang diterima.' : 'Untuk belanja toko, listrik, parkir, dan kebutuhan lainnya.'}</DialogDescription></DialogHeader>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setError('');
        try {
          if (isAdmin) await recordBiayaAdmin({ count: Number(count), profit: amount });
          else await recordExpense(name, amount);
          toast({ title: `${title} sudah dicatat ✓`, description: `${formatRupiah(Number(amount))}${isAdmin ? ` · ${count} transaksi jasa` : ` · ${name}`}` });
          setOpen(false);
          setAmount(''); setName(''); setCount('');
          router.refresh();
        } catch {
          setError('Belum berhasil menyimpan. Isian tetap disimpan di sini, silakan coba lagi.');
        } finally { pendingRef.current = false; setPending(false); }
      }} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          {isAdmin ? <div className="space-y-2"><Label htmlFor={`${prefix}-count`}>Berapa transaksi jasa?</Label><Input id={`${prefix}-count`} type="text" inputMode="numeric" pattern="[0-9]+" placeholder="Contoh: 12" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} autoFocus required /></div> : <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>Untuk apa?</Label><Input id={`${prefix}-name`} placeholder="Contoh: listrik atau parkir" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required /><div className="flex flex-wrap gap-2">{['Listrik', 'Parkir', 'Belanja toko'].map((label) => <button type="button" key={label} onClick={() => setName(label)} className="min-h-11 rounded-full border px-3 text-xs hover:bg-muted">{label}</button>)}</div></div>}
          <div className="space-y-2"><Label htmlFor={`${prefix}-amount`}>{isAdmin ? 'Total biaya admin yang didapat' : 'Berapa nominalnya?'}</Label><div className="relative"><span className="absolute left-3 top-3 text-muted-foreground">Rp</span><Input id={`${prefix}-amount`} type="text" inputMode="numeric" pattern="[0-9]+" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className="h-12 pl-10 text-lg font-semibold" required /></div></div>
          <div className="rounded-xl bg-muted/60 p-3 text-sm"><span className="text-muted-foreground">{isAdmin ? 'Biaya admin diterima' : 'Cash berkurang'}</span><div className="mt-1 text-xl font-bold">{formatRupiah(Number(amount) || 0)}</div></div>
        </fieldset>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={!valid || pending} className="w-full rounded-xl">{pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : `Catat ${title}`}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

export function FinishShift() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState<{ salesCount: number; servicesCount: number } | null>(null);
  const noteId = React.useId();
  return <Dialog open={open} onOpenChange={(value) => { if (!pendingRef.current) { setOpen(value); if (!value) { setResult(null); setError(''); } } }}>
    <button onClick={() => setOpen(true)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-dashed bg-muted/30 p-4 text-left hover:bg-muted/60"><Moon className="h-5 w-5 shrink-0 text-muted-foreground" /><span className="flex-1"><span className="block text-sm font-semibold">Selesai Shift</span><span className="block text-xs text-muted-foreground">Simpan rekap & catatan serah terima</span></span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>
    <DialogContent>
      <DialogHeader><DialogTitle>{result ? 'Rekap shift tersimpan' : 'Selesai untuk hari ini?'}</DialogTitle><DialogDescription>{result ? 'Terima kasih! Catatan kerja kamu sudah disimpan.' : 'Simpan rekap transaksi hari ini dan titipkan catatan untuk shift berikutnya.'}</DialogDescription></DialogHeader>
      {result ? <div className="space-y-5"><div className="rounded-2xl bg-primary/10 p-5 text-center"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-primary" /><p className="font-semibold">Kerja bagus hari ini!</p><p className="mt-2 text-sm text-muted-foreground">{result.salesCount} penjualan · {result.servicesCount} rekap jasa</p></div><Button size="lg" className="w-full rounded-xl" onClick={() => { setOpen(false); setResult(null); setNote(''); router.refresh(); }}>Kembali ke beranda</Button></div> : <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (pendingRef.current) return;
        pendingRef.current = true; setPending(true); setError('');
        try {
          const summary = await closeShift(note);
          setResult({ salesCount: summary.salesCount, servicesCount: summary.servicesCount });
          router.refresh();
        } catch { setError('Rekap belum tersimpan. Silakan coba lagi.'); }
        finally { pendingRef.current = false; setPending(false); }
      }}>
        <div className="space-y-2"><Label htmlFor={noteId}>Catatan untuk shift berikutnya <span className="font-normal text-muted-foreground">(opsional)</span></Label><Textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: voucher XL tinggal sedikit, tolong cek rak depan." rows={4} maxLength={1000} disabled={pending} /></div>
        <p className="text-xs leading-relaxed text-muted-foreground">Rekap berisi penjualan, biaya admin, dan pengeluaran yang kamu catat hari ini.</p>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>{pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : 'Simpan Rekap Shift'}</Button>
      </form>}
    </DialogContent>
  </Dialog>;
}
