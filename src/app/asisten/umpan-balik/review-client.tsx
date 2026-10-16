'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Feedback = { id: number; query: string; note: string | null; productId: number | null; status: string;
  createdAt: string; user: { username: string }; product: { name: string } | null };
type Product = { id: number; name: string; provider: string | null; validity: string | null };

export function FeedbackReview() {
  const [feedback, setFeedback] = React.useState<Feedback[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [failedSearches, setFailedSearches] = React.useState<{ query: string; count: number }[]>([]);
  const [choices, setChoices] = React.useState<Record<number, number>>({});
  const [searches, setSearches] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void fetch('/api/assistant/feedback').then(async (response) => {
      const data = await response.json() as { feedback?: Feedback[]; products?: Product[]; failedSearches?: { query: string; count: number }[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Masukan gagal dimuat.');
      setFeedback(data.feedback || []);
      setProducts(data.products || []);
      setFailedSearches(data.failedSearches || []);
      setChoices(Object.fromEntries((data.feedback || []).filter((item) => item.productId !== null).map((item) => [item.id, item.productId!])));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Masukan gagal dimuat.')).finally(() => setLoading(false));
  }, []);

  const decide = async (item: Feedback, status: 'APPROVED' | 'REJECTED' | 'REVOKED') => {
    setBusy(item.id);
    setError('');
    try {
      const response = await fetch('/api/assistant/feedback', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status, productId: choices[item.id] || undefined }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Keputusan belum tersimpan.');
      setFeedback((current) => current.filter((entry) => entry.id !== item.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Keputusan belum tersimpan.'); }
    finally { setBusy(null); }
  };

  return <main className="mx-auto max-w-3xl space-y-4 pb-20">
    <div><Link href="/" className="text-sm text-primary underline">← Kembali</Link><h1 className="mt-2 text-2xl font-bold">Masukan asisten</h1><p className="text-sm text-muted-foreground">Tinjau usulan padanan kata. Persetujuan hanya membantu pencarian; tidak mengubah harga, stok, atau detail barang.</p></div>
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {!!failedSearches.length && <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">Pencarian tanpa hasil, 30 hari terakhir</h2><p className="mb-2 text-xs text-muted-foreground">Istilah pencarian saja, tanpa identitas karyawan atau foto. Gunakan daftar ini untuk meninjau kekosongan katalog atau padanan kata.</p><div className="flex flex-wrap gap-2">{failedSearches.map((entry) => <span key={entry.query} className="rounded-full bg-muted px-3 py-1 text-xs">{entry.query} · {entry.count}×</span>)}</div></section>}
    {loading ? <p className="text-sm">Memuat masukan...</p> : feedback.length === 0 ? <p className="rounded-xl border p-4 text-sm text-muted-foreground">Belum ada masukan yang menunggu atau disetujui.</p> : feedback.map((item) => {
      const needle = (searches[item.id] || '').toLowerCase();
      const options = products.filter((product) => !needle || [product.name, product.provider, product.validity].filter(Boolean).join(' ').toLowerCase().includes(needle)).slice(0, 50);
      const chosen = choices[item.id] || item.productId || 0;
      return <article key={item.id} className="space-y-3 rounded-xl border bg-card p-4">
        <div><p className="text-xs text-muted-foreground">{item.status === 'APPROVED' ? 'Disetujui · ' : 'Menunggu · '}{item.user.username} · {new Date(item.createdAt).toLocaleString('id-ID')}</p><p className="mt-1 font-medium">“{item.query}”</p>{item.note && <p className="text-sm">Koreksi: {item.note}</p>}{item.product && <p className="text-sm text-muted-foreground">Pilihan karyawan: {item.product.name}</p>}</div>
        <div className="space-y-1"><label htmlFor={`search-${item.id}`} className="text-xs font-medium">Barang katalog yang benar</label><Input id={`search-${item.id}`} value={searches[item.id] || ''} onChange={(event) => setSearches((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Cari nama barang..." /><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label="Pilih barang katalog" value={chosen} onChange={(event) => setChoices((current) => ({ ...current, [item.id]: Number(event.target.value) }))}><option value={0}>Pilih barang</option>{chosen && !options.some((product) => product.id === chosen) && products.filter((product) => product.id === chosen).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}{options.map((product) => <option key={product.id} value={product.id}>{[product.name, product.provider, product.validity].filter(Boolean).join(' · ')}</option>)}</select></div>
        <div className="flex gap-2">{item.status === 'PENDING' ? <><Button type="button" size="sm" disabled={busy !== null || !chosen} onClick={() => void decide(item, 'APPROVED')}>Setujui padanan</Button><Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(item, 'REJECTED')}>Tolak</Button></> : <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(item, 'REVOKED')}>Cabut padanan</Button>}</div>
      </article>;
    })}
  </main>;
}
