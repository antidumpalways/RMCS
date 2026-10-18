'use client';

import * as React from 'react';
import { Bot, CheckCircle2, ImagePlus, Loader2, MessageCircle, PackagePlus, Send, ShoppingBag, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyCatalogDraft, recordCartSale, recordShiftStockCheck, replaceSaleFromChat } from '@/lib/actions';
import { applyAssistantDraft } from '@/lib/assistant-actions';
import { formatRupiah } from '@/lib/utils';

type CatalogProduct = {
  id: number;
  name: string;
  categoryName: string;
  provider: string | null;
  validity: string | null;
  sellPrice: string;
  stock: number;
  matchConfidence?: 'exact' | 'high' | 'medium' | 'low';
};
type StockProposal = {
  phase: 'buka' | 'tutup';
  items: { productId: number; productName: string; physicalStock: number }[];
};
type SaleProposal = {
  kind: 'create' | 'edit';
  saleId?: number;
  expectedSignature?: string;
  previousItems?: { name: string; qty: number }[];
  items: { productId: number; name: string; qty: number; unitPrice: string }[];
  totalRevenue: string;
};
type CatalogProposal = {
  kind: 'create' | 'update';
  productId?: number;
  expectedSignature?: string;
  fields: {
    name: string;
    categoryId: number;
    categoryName: string;
    provider: string | null;
    validity: string | null;
    costPrice: string;
    sellPrice: string;
    stock: number;
    minStock: number;
  };
  changes?: { label: string; from: string; to: string }[];
};
type AssistantDraft = {
  action: 'catalog.delete' | 'price.bulk' | 'stock.in' | 'stock.adjust'
    | 'opname.record' | 'opname.apply' | 'opname.review' | 'opname.delete'
    | 'debt.create' | 'debt.pay' | 'debt.delete'
    | 'expense.create' | 'service.create' | 'shift.close'
    | 'memory.save' | 'memory.forget';
  title: string;
  lines: { label: string; value: string; emphasis?: boolean }[];
  payload: Record<string, unknown>;
};
type ChatLine = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  catalog?: CatalogProduct[];
  stockProposal?: StockProposal | null;
  saleProposal?: SaleProposal | null;
  catalogProposal?: CatalogProposal | null;
  draft?: AssistantDraft | null;
  image?: string;
  query?: string;
  hasImage?: boolean;
  canFeedback?: boolean;
};

async function prepareImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Pilih foto JPG, PNG, WebP, atau GIF.');
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = canvas.toDataURL('image/jpeg', 0.78);
  if (result.length > 2_800_000) throw new Error('Foto masih terlalu besar. Coba foto lain.');
  return result;
}

function formatCatalogValue(label: string, value: string) {
  return label.startsWith('Harga') && /^\d+$/.test(value) ? formatRupiah(BigInt(value)) : value;
}

export function AssistantChat({ role }: { role: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [lines, setLines] = React.useState<ChatLine[]>([]);
  const [image, setImage] = React.useState<string | null>(null);
  const [feedbackNotes, setFeedbackNotes] = React.useState<Record<string, string>>({});
  const [feedbackDone, setFeedbackDone] = React.useState<string[]>([]);
  const [feedbackBusy, setFeedbackBusy] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const photoTextRef = React.useRef<Promise<string> | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const savingRef = React.useRef<string | null>(null);
  const canRecordStock = role === 'karyawan';

  React.useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, lines, busy]);

  const send = async (value = text) => {
    const content = value.trim();
    if ((!content && !image) || busy) return;
    const actualContent = content || 'Barang apa ini? Tolong cari di katalog.';
    const sentImage = image;
    const photoTextPromise = photoTextRef.current;
    const userLine: ChatLine = { id: crypto.randomUUID(), role: 'user', content: actualContent, image: sentImage || undefined };
    const next = [...lines, userLine];
    setLines(next);
    setText('');
    setImage(null);
    photoTextRef.current = null;
    setBusy(true);
    setError('');
    try {
      const ocrText = sentImage && photoTextPromise
        ? await Promise.race([photoTextPromise, new Promise<string>((resolve) => setTimeout(() => resolve(''), 12_000))])
        : '';
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-12).map(({ role: messageRole, content: messageContent }) => ({ role: messageRole, content: messageContent.slice(0, 700) })), ...(sentImage ? { image: sentImage, ocrText } : {}) }),
      });
      const result = await response.json() as {
        message?: string;
        catalog?: CatalogProduct[];
        stockProposal?: StockProposal | null;
        saleProposal?: SaleProposal | null;
        catalogProposal?: CatalogProposal | null;
        draft?: AssistantDraft | null;
        canFeedback?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Asisten sedang tidak tersedia.');
      setLines((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message || 'Saya belum bisa membantu untuk pertanyaan itu.',
        catalog: result.catalog,
        stockProposal: result.stockProposal,
        saleProposal: result.saleProposal,
        catalogProposal: result.catalogProposal,
        draft: result.draft,
        query: actualContent,
        hasImage: !!sentImage,
        canFeedback: result.canFeedback,
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesan belum terkirim. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async (line: ChatLine, productId?: number) => {
    if (!line.query || feedbackBusy) return;
    setFeedbackBusy(line.id);
    setError('');
    try {
      const response = await fetch('/api/assistant/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: line.query, productId, note: feedbackNotes[line.id] || undefined }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Masukan belum terkirim.');
      setFeedbackDone((current) => [...current, line.id]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Masukan belum terkirim.');
    } finally { setFeedbackBusy(null); }
  };

  const confirmStock = async (line: ChatLine, proposal: StockProposal) => {
    if (savingRef.current) return;
    savingRef.current = line.id;
    setSavingId(line.id);
    setError('');
    try {
      const result = await recordShiftStockCheck({
        phase: proposal.phase,
        counts: proposal.items.map(({ productId, physicalStock }) => ({ productId, physicalStock })),
      });
      const confirmation = `Tersimpan: ${result.checkedCount} barang dicek saat ${proposal.phase === 'buka' ? 'buka' : 'tutup'} toko. ${result.changedCount ? `${result.changedCount} barang berselisih dan menunggu owner.` : 'Tidak ada selisih.'} Stok aplikasi belum berubah.`;
      setLines((current) => current.map((item) => item.id === line.id
        ? { ...item, content: `${item.content}\n\n${confirmation}`, stockProposal: null }
        : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Belum berhasil menyimpan cek stok.');
    } finally {
      savingRef.current = null;
      setSavingId(null);
    }
  };

  const confirmSale = async (line: ChatLine, proposal: SaleProposal) => {
    if (savingRef.current) return;
    savingRef.current = line.id;
    setSavingId(line.id);
    setError('');
    try {
      let saleId: number;
      if (proposal.kind === 'create') {
        const result = await recordCartSale(
          proposal.items.map(({ productId, qty }) => ({ productId, qty })),
          proposal.items.map(({ productId, unitPrice }) => ({ productId, sellPrice: unitPrice })),
        );
        if (result.error || !result.saleId) throw new Error(result.error || 'Penjualan belum tersimpan.');
        saleId = result.saleId;
      } else {
        if (!proposal.saleId || !proposal.expectedSignature) throw new Error('Draf koreksi tidak lengkap.');
        const result = await replaceSaleFromChat({
          saleId: proposal.saleId,
          expectedSignature: proposal.expectedSignature,
          items: proposal.items.map(({ productId, qty, unitPrice }) => ({ productId, qty, expectedPrice: unitPrice })),
        });
        saleId = result.saleId;
      }
      const confirmation = proposal.kind === 'create'
        ? `Penjualan #${saleId} tersimpan. Stok dan omzet hari ini sudah diperbarui.`
        : `Penjualan #${saleId} dikoreksi. Stok dan omzet hari ini sudah disesuaikan.`;
      setLines((current) => current.map((item) => item.id === line.id
        ? { ...item, content: `${item.content}\n\n${confirmation}`, saleProposal: null }
        : item));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Penjualan belum berhasil disimpan.');
    } finally {
      savingRef.current = null;
      setSavingId(null);
    }
  };

  const confirmCatalog = async (line: ChatLine, proposal: CatalogProposal) => {
    if (savingRef.current) return;
    savingRef.current = line.id;
    setSavingId(line.id);
    setError('');
    try {
      await applyCatalogDraft({
        kind: proposal.kind,
        productId: proposal.productId,
        expectedSignature: proposal.expectedSignature,
        fields: {
          name: proposal.fields.name,
          categoryId: proposal.fields.categoryId,
          provider: proposal.fields.provider,
          validity: proposal.fields.validity,
          costPrice: proposal.fields.costPrice,
          sellPrice: proposal.fields.sellPrice,
          stock: proposal.fields.stock,
          minStock: proposal.fields.minStock,
        },
      });
      const confirmation = proposal.kind === 'create'
        ? `Barang “${proposal.fields.name}” ditambahkan ke katalog.`
        : `Perubahan “${proposal.fields.name}” diterapkan ke katalog.`;
      setLines((current) => current.map((item) => item.id === line.id
        ? { ...item, content: `${item.content}\n\n${confirmation}`, catalogProposal: null }
        : item));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Perubahan katalog belum berhasil disimpan.');
    } finally {
      savingRef.current = null;
      setSavingId(null);
    }
  };

  const confirmDraft = async (line: ChatLine, value: AssistantDraft) => {
    if (savingRef.current) return;
    savingRef.current = line.id;
    setSavingId(line.id);
    setError('');
    try {
      const result = await applyAssistantDraft({ action: value.action, payload: value.payload });
      const confirmation = result.message || 'Perubahan diterapkan.';
      setLines((current) => current.map((item) => item.id === line.id
        ? { ...item, content: `${item.content}\n\n${confirmation}`, draft: null }
        : item));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Perubahan belum berhasil disimpan.');
    } finally {
      savingRef.current = null;
      setSavingId(null);
    }
  };

  return <>
    {open && <section aria-label="Asisten R CELL" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex h-[min(72dvh,620px)] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:right-6" role="dialog" aria-modal="false">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold">Asisten R CELL</h2><p className="text-[11px] text-muted-foreground">AI DeepSeek · harga sesuai katalog</p>{role === 'owner' && <Link className="text-[11px] text-primary underline" href="/asisten/umpan-balik" onClick={() => setOpen(false)}>Tinjau masukan</Link>}</div></div>
        <Button type="button" size="icon" variant="ghost" aria-label="Tutup chat" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {!lines.length && <div className="space-y-3 pt-2">
          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-muted p-3 text-sm">Halo! Tulis saja seperti biasa, meski singkat atau ada typo. Saya bisa bantu mencari harga, mencatat penjualan, mengoreksi penjualan hari ini, dan menyiapkan cek stok.</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Berapa harga barang ...?')}>Cari harga</button>
            <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau catat penjualan hari ini. Tolong tanya barang dan jumlah yang terjual.')}>Catat penjualan</button>
            <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau koreksi penjualan terakhir. Tolong tanya perubahan yang benar sebelum menyiapkan draf.')}>Koreksi penjualan</button>
            {role === 'owner' && <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau tambah barang baru ke katalog. Tolong tanya nama barang, kategori, harga jual, dan stoknya dulu sebelum menyiapkan draf.')}>Tambah barang</button>}
            <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau mencatat bon pelanggan. Tolong tanya nama pelanggan dan nominalnya dulu sebelum menyiapkan draf.')}>Catat bon</button>
            {role === 'owner' && <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau mencatat pengeluaran toko. Tolong tanya nama dan nominal pengeluarannya dulu sebelum menyiapkan draf.')}>Catat pengeluaran</button>}
            {role === 'owner' && <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau kamu mengingat sesuatu. Tanya dulu apa yang perlu diingat dan jenisnya (istilah khas, cara bicara, atau aturan toko) sebelum menyiapkan draf.')}>Ingat sesuatu</button>}
            {canRecordStock && <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau catat stok saat tutup toko. Tolong tanya barang dan jumlahnya dulu.')}>Catat stok</button>}
          </div>
        </div>}
        {lines.map((line) => <div key={line.id} className={`space-y-2 ${line.role === 'user' ? 'ml-auto max-w-[90%]' : 'mr-auto max-w-[95%]'}`}>
          <div className={`whitespace-pre-wrap rounded-2xl p-3 text-sm leading-relaxed ${line.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted'}`}>{line.image && <img src={line.image} alt="Foto barang yang ditanyakan" className="mb-2 max-h-32 max-w-full rounded-lg object-contain" />}{line.content}</div>
          {!!line.catalog?.length && <div className="space-y-2">{line.catalog.map((product) => <article key={product.id} className="rounded-xl border bg-card p-3 text-sm">
            <p className="font-semibold leading-snug">{product.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[product.categoryName, product.provider, product.validity].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-primary">{formatRupiah(BigInt(product.sellPrice))}</strong><span className="text-xs text-muted-foreground">Stok {product.stock}</span></div>
            {product.matchConfidence !== 'exact' && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Kemungkinan cocok — periksa nama dan varian.</p>}
            {line.query && !line.hasImage && !feedbackDone.includes(line.id) && <button type="button" className="mt-2 text-xs text-primary underline" disabled={feedbackBusy !== null} onClick={() => void submitFeedback(line, product.id)}>Ini barang yang benar</button>}
          </article>)}</div>}
          {line.canFeedback && line.query && !line.hasImage && (feedbackDone.includes(line.id)
            ? <p className="text-xs text-muted-foreground">Terima kasih. Owner akan meninjau masukan ini.</p>
            : <div className="space-y-1"><label htmlFor={`feedback-${line.id}`} className="text-xs text-muted-foreground">Belum tepat? Tulis nama atau ciri barang yang dimaksud.</label><Input id={`feedback-${line.id}`} value={feedbackNotes[line.id] || ''} maxLength={200} onChange={(event) => setFeedbackNotes((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Contoh: charger mobil colokan USB-C" /><Button size="sm" type="button" variant="outline" disabled={!feedbackNotes[line.id]?.trim() || feedbackBusy !== null} onClick={() => void submitFeedback(line)}>{feedbackBusy === line.id ? 'Mengirim...' : 'Kirim koreksi ke owner'}</Button></div>)}
          {canRecordStock && line.stockProposal && <div className="rounded-xl border border-primary/30 bg-card p-3">
            <p className="text-xs font-semibold">Periksa draf cek stok {line.stockProposal.phase === 'buka' ? 'saat buka' : 'saat tutup'}</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{line.stockProposal.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-xs"><span className="min-w-0 truncate">{item.productName}</span><strong className="shrink-0">{item.physicalStock}</strong></div>)}</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Cek nama barang dan jumlahnya. Hasil akan disimpan sebagai catatan; selisih tetap menunggu owner.</p>
            <Button type="button" size="sm" className="mt-3 w-full" disabled={savingId !== null} onClick={() => void confirmStock(line, line.stockProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> Simpan hasil hitung</>}
            </Button>
          </div>}
          {line.saleProposal && <div className="rounded-xl border border-primary/30 bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><ShoppingBag className="h-4 w-4" /> {line.saleProposal.kind === 'create' ? 'Draf penjualan hari ini' : `Koreksi penjualan #${line.saleProposal.saleId}`}</p>
            {!!line.saleProposal.previousItems?.length && <div className="mt-2 rounded-lg bg-muted p-2 text-xs"><p className="font-medium">Catatan lama</p>{line.saleProposal.previousItems.map((item, index) => <p key={index}>{item.name} × {item.qty}</p>)}</div>}
            <div className="mt-2 space-y-1">{line.saleProposal.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-xs"><span>{item.name} × {item.qty}</span><span className="shrink-0 font-medium">{formatRupiah(BigInt(item.unitPrice) * BigInt(item.qty))}</span></div>)}</div>
            <p className="mt-2 border-t pt-2 text-right font-semibold">Total {formatRupiah(BigInt(line.saleProposal.totalRevenue))}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Periksa semua barang dan jumlahnya. Database dan stok baru berubah setelah Anda menekan tombol ini.</p>
            <Button type="button" size="sm" className="mt-3 w-full" disabled={savingId !== null} onClick={() => void confirmSale(line, line.saleProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> {line.saleProposal.kind === 'create' ? 'Konfirmasi penjualan' : 'Konfirmasi koreksi'}</>}
            </Button>
          </div>}
          {line.catalogProposal && <div className="rounded-xl border border-primary/30 bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><PackagePlus className="h-4 w-4" /> {line.catalogProposal.kind === 'create' ? 'Draf barang baru' : `Draf perubahan “${line.catalogProposal.fields.name}”`}</p>
            {line.catalogProposal.kind === 'update' ? <div className="mt-2 space-y-1">{line.catalogProposal.changes?.map((change) => <div key={change.label} className="text-xs"><span className="text-muted-foreground">{change.label}: </span><span className="text-muted-foreground line-through">{formatCatalogValue(change.label, change.from)}</span><span aria-hidden> → </span><strong>{formatCatalogValue(change.label, change.to)}</strong></div>)}</div> : <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Nama</span><strong>{line.catalogProposal.fields.name}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Kategori</span><strong>{line.catalogProposal.fields.categoryName}</strong></div>
              {line.catalogProposal.fields.provider && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Provider</span><strong>{line.catalogProposal.fields.provider}</strong></div>}
              {line.catalogProposal.fields.validity && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Masa aktif</span><strong>{line.catalogProposal.fields.validity}</strong></div>}
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Harga beli</span><span>{formatRupiah(BigInt(line.catalogProposal.fields.costPrice))}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Harga jual</span><strong>{formatRupiah(BigInt(line.catalogProposal.fields.sellPrice))}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Stok</span><span>{line.catalogProposal.fields.stock}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Stok minimal</span><span>{line.catalogProposal.fields.minStock}</span></div>
            </div>}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Periksa nama, kategori, dan nilainya. Katalog baru berubah setelah Anda menekan tombol ini.</p>
            <Button type="button" size="sm" className="mt-3 w-full" disabled={savingId !== null} onClick={() => void confirmCatalog(line, line.catalogProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> {line.catalogProposal.kind === 'create' ? 'Konfirmasi tambah barang' : 'Konfirmasi ubah barang'}</>}
            </Button>
          </div>}
          {line.draft && <div className="rounded-xl border border-amber-300/60 bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" /> {line.draft.title}</p>
            <div className="mt-2 space-y-1 text-xs">{line.draft.lines.map((entry, index) => <div key={index} className="flex justify-between gap-3"><span className="text-muted-foreground">{entry.label}</span><strong className={entry.emphasis ? '' : 'font-medium'}>{entry.value}</strong></div>)}</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Periksa nilainya. Data baru berubah setelah Anda menekan tombol ini.</p>
            <Button type="button" size="sm" className="mt-3 w-full" disabled={savingId !== null} onClick={() => void confirmDraft(line, line.draft!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> Konfirmasi</>}
            </Button>
          </div>}
        </div>)}
        {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Asisten sedang mencari...</div>}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      </div>
      {image && <div className="flex items-center gap-2 border-t px-3 py-2 text-xs"><img src={image} alt="Foto siap dikirim" className="h-10 w-10 rounded object-cover" /><span className="flex-1">Foto siap dikirim. Pastikan tulisan pada label terlihat dekat dan terang.</span><button type="button" aria-label="Hapus foto" onClick={() => { setImage(null); photoTextRef.current = null; }}><X className="h-4 w-4" /></button></div>}
      <form className="flex items-center gap-2 border-t bg-background p-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" aria-label="Pilih foto barang" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setImage(await prepareImage(file)); photoTextRef.current = import('@/lib/browser-ocr').then(({ readPhotoText }) => readPhotoText(file)).catch(() => ''); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Foto gagal diproses.'); } event.target.value = ''; }} />
        <Button type="button" size="icon" variant="outline" aria-label="Tambahkan foto barang" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" /></Button>
        <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Tanyakan dengan bahasa sehari-hari..." aria-label="Pesan untuk asisten" maxLength={700} disabled={busy} />
        <Button type="submit" size="icon" aria-label="Kirim pesan" disabled={busy || (!text.trim() && !image)}><Send className="h-4 w-4" /></Button>
      </form>
    </section>}
    {!open && <Button type="button" size="icon" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-50 h-14 w-14 rounded-full shadow-lg sm:bottom-6 sm:right-6" aria-label="Buka asisten R CELL" aria-expanded={open} onClick={() => setOpen(true)}>
      <MessageCircle className="h-6 w-6" />
    </Button>}
  </>;
}
