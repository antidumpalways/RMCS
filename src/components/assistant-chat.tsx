'use client';

import * as React from 'react';
import { Bot, CheckCircle2, ImagePlus, Loader2, PackagePlus, Send, ShoppingBag, Sparkles, SquarePen, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recordCartSale } from '@/lib/actions';
import { applyAssistantCatalogDraft, applyAssistantDraft, applyAssistantSaleCorrection, applyAssistantStockCheck } from '@/lib/assistant-actions';
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
  items: { productId: number; name: string; qty: number; unitPrice: string; profit: string; stockAfter: number }[];
  totalRevenue: string;
  totalProfit: string;
  marginPercent: string;
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
type AuditFinding = {
  kind: 'name' | 'provider' | 'validity' | 'subcategory' | 'duplicate' | 'zeroStock';
  label: string;
  detail: string;
  category?: string;
  productId?: number;
  productIds?: number[];
};

function groupAuditByCategory(findings: AuditFinding[]) {
  const groups = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    const key = finding.category ?? 'Tanpa kategori';
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }
  return [...groups.entries()];
}
const AUDIT_KIND_LABELS: Record<AuditFinding['kind'], string> = {
  name: 'Nama barang', provider: 'Provider', validity: 'Masa aktif',
  subcategory: 'Kategori/subkategori', duplicate: 'Barang mirip/duplikat', zeroStock: 'Stok 0',
};
const AUDIT_GROUP_ORDER: AuditFinding['kind'][] = ['name', 'provider', 'validity', 'subcategory', 'duplicate', 'zeroStock'];
type AssistantDraft = {
  action: 'catalog.delete' | 'catalog.cleanup' | 'price.bulk' | 'stock.in' | 'stock.adjust'
    | 'category.create' | 'category.rename' | 'category.delete'
    | 'subcategory.create' | 'subcategory.rename' | 'subcategory.delete'
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
  audit?: AuditFinding[] | null;
  auditCounts?: Partial<Record<AuditFinding['kind'], number>> | null;
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

function saleQuantityFromQuery(query: string): number | null {
  if (!/\b(?:laku|jual|terjual|kejual)\b/i.test(query)) return null;
  if (query.length > 180 || /[\n;,]|\s+dan\s+/i.test(query) ||
      [...query.matchAll(/\b(?:laku|jual|terjual|kejual)\b/gi)].length !== 1) return null;
  const withUnit = [...query.matchAll(/\b(\d{1,7})\s*(?:pcs?|buah|biji|unit|lembar|item|pack|pak)\b|\b(?:pcs?|buah|biji|unit|lembar|item|pack|pak)\s*(\d{1,7})\b/gi)];
  const matches = withUnit.length ? withUnit
    : [...query.matchAll(/\b(?:laku|jual|terjual|kejual)\s+(\d{1,7})\b(?!\s*(?:ribu|rb|rupiah|rp)\b)/gi)];
  if (matches.length !== 1) return null;
  const qty = Number(matches[0][1] ?? matches[0][2]);
  return Number.isSafeInteger(qty) && qty > 0 ? qty : null;
}

export function AssistantChat({ role, userId }: { role: string; userId: number }) {
  const router = useRouter();
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
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const photoTextRef = React.useRef<Promise<string> | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const savingRef = React.useRef<string | null>(null);
  const canRecordStock = true;
  const storageKey = `rcms:assistant:${userId}:v1`;
  const [restored, setRestored] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as unknown;
      if (Array.isArray(saved)) {
        setLines(saved.filter((line): line is ChatLine => Boolean(line) && typeof line === 'object' &&
          typeof line.id === 'string' && (line.role === 'user' || line.role === 'assistant') &&
          typeof line.content === 'string').slice(-40));
      }
    } catch { /* A damaged browser session starts with a clean conversation. */ }
    setRestored(true);
  }, [storageKey]);

  React.useEffect(() => {
    if (!restored) return;
    try {
      const safeHistory = lines.slice(-40).map((line) => ({
        id: line.id, role: line.role,
        content: line.saleProposal || line.stockProposal || line.catalogProposal || line.draft
          ? 'Draf ini belum disimpan. Tulis perintahnya lagi untuk menyiapkan draf baru.'
          : line.catalog?.length || line.audit?.length
            ? 'Hasil sebelumnya perlu dicari ulang agar datanya tetap terbaru.'
            : line.content,
      }));
      sessionStorage.setItem(storageKey, JSON.stringify(safeHistory));
    } catch { /* Chat tetap dapat dipakai bila penyimpanan browser penuh. */ }
  }, [lines, restored, storageKey]);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, busy]);

  const startPrompt = (value: string) => {
    setText(value);
    inputRef.current?.focus();
  };

  const newConversation = () => {
    setLines([]);
    setText('');
    setImage(null);
    photoTextRef.current = null;
    setError('');
    setFeedbackNotes({});
    setFeedbackDone([]);
    sessionStorage.removeItem(storageKey);
    inputRef.current?.focus();
  };

  const send = async (value = text) => {
    const content = value.trim();
    if ((!content && !image) || busy || savingRef.current) return;
    const actualContent = content || 'Barang apa ini? Tolong cari di katalog.';
    const sentImage = image;
    const photoTextPromise = photoTextRef.current;
    const userLine: ChatLine = { id: crypto.randomUUID(), role: 'user', content: actualContent, image: sentImage || undefined };
    const next = [...lines, userLine];
    const pendingDraft = lines.some((line) => line.saleProposal || line.stockProposal || line.catalogProposal || line.draft);
    const keepPendingDraft = pendingDraft && /^(?:betul|betul\s+itu|benar|iya|ya|yap|oke|ok|sip|cocok|itu\s+yang\s+benar)[.!\s]*$/i.test(actualContent);
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
        body: JSON.stringify({ messages: next.slice(-12).map(({ role: messageRole, content: messageContent }) => ({ role: messageRole, content: messageContent.slice(0, messageRole === 'user' ? 6000 : 2000) })), pendingDraft, ...(sentImage ? { image: sentImage, ocrText } : {}) }),
      });
      const result = await response.json() as {
        message?: string;
        catalog?: CatalogProduct[];
        stockProposal?: StockProposal | null;
        saleProposal?: SaleProposal | null;
        catalogProposal?: CatalogProposal | null;
        draft?: AssistantDraft | null;
        audit?: AuditFinding[] | null;
        auditCounts?: Partial<Record<AuditFinding['kind'], number>> | null;
        canFeedback?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Asisten sedang tidak tersedia.');
      setLines((current) => [...current.map((line) => keepPendingDraft ||
          (!line.saleProposal && !line.stockProposal && !line.catalogProposal && !line.draft) ? line : {
            ...line,
            content: `${line.content}\n\nDraf ini sudah digantikan. Tulis lagi jika masih ingin menjalankannya.`,
            saleProposal: null, stockProposal: null, catalogProposal: null, draft: null,
          }), {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message || 'Saya belum bisa membantu untuk pertanyaan itu.',
        catalog: result.catalog,
        stockProposal: result.stockProposal,
        saleProposal: result.saleProposal,
        catalogProposal: result.catalogProposal,
        draft: result.draft,
        audit: result.audit,
        auditCounts: result.auditCounts,
        query: actualContent,
        hasImage: !!sentImage,
        canFeedback: result.canFeedback,
      }]);
    } catch (caught) {
      setLines((current) => current.filter((line) => line.id !== userLine.id));
      setText(content);
      if (sentImage) {
        setImage(sentImage);
        photoTextRef.current = photoTextPromise;
      }
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
      const result = await applyAssistantStockCheck({
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
        const result = await applyAssistantSaleCorrection({
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
      await applyAssistantCatalogDraft({
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

  return <section aria-label="Asisten R CELL" className="flex min-h-[23rem] flex-col overflow-hidden rounded-[1.75rem] border bg-card shadow-[0_18px_55px_-34px_hsl(var(--foreground)/0.35)]" style={{ height: 'calc(100dvh - 11.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-sm"><Bot className="h-6 w-6" /></span><div className="min-w-0"><h1 className="truncate text-base font-bold tracking-tight">Tanya Asisten</h1><p className="text-xs text-muted-foreground">Tulis seperti bicara ke teman kerja</p></div></div>
        <div className="flex shrink-0 items-center gap-1">{role === 'owner' && <Link className="inline-flex min-h-10 items-center rounded-xl px-2 text-[11px] font-semibold text-primary hover:bg-primary/10 sm:px-3" href="/asisten/umpan-balik">Masukan</Link>}<Button type="button" size="icon" variant="ghost" aria-label="Mulai percakapan baru" title="Percakapan baru" disabled={busy || savingId !== null} onClick={newConversation}><SquarePen className="h-5 w-5" /></Button></div>
      </header>
      <div ref={scrollRef} role="log" aria-label="Percakapan asisten" aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-background/50 via-background/20 to-card px-3 py-5 sm:px-6">
        {!lines.length && <div className="mx-auto flex h-full max-w-lg flex-col justify-center py-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-7 w-7" /></span>
          <h2 className="mt-5 text-2xl font-bold tracking-tight">Mau dibantu apa hari ini?</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Ceritakan dengan bahasamu sendiri. Kalau ada perubahan data, kamu akan melihat ringkasannya dulu sebelum menyimpan.</p>
          <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Mulai dari sini</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              ['Catat penjualan', 'Laku '],
              ['Cari harga', 'Berapa harga '],
              ['Barang masuk', 'Barang masuk '],
              ['Catat bon', 'Catat bon '],
              ['Ubah katalog', 'Ubah barang '],
              ['Ringkasan shift', 'Penjualan shift ini: '],
            ].map(([label, prompt]) => <button key={label} type="button" className="min-h-14 rounded-2xl border bg-card px-3 py-2 text-left text-sm font-semibold shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => startPrompt(prompt)}>{label}<span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Tulis dengan kata-katamu</span></button>)}
          </div>
        </div>}
        {lines.map((line) => <div key={line.id} className={`space-y-2 ${line.role === 'user' ? 'ml-auto max-w-[88%]' : 'mr-auto max-w-[96%]'}`}>
          <p className={`px-1 text-[11px] font-semibold text-muted-foreground ${line.role === 'user' ? 'text-right' : ''}`}>{line.role === 'user' ? 'Kamu' : 'Asisten R CELL'}</p>
          <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${line.role === 'user' ? 'rounded-tr-md bg-primary text-primary-foreground' : 'rounded-tl-md border bg-card'}`}>{line.image && <img src={line.image} alt="Foto barang yang ditanyakan" className="mb-2 max-h-32 max-w-full rounded-lg object-contain" />}{line.content}</div>
          {!!line.catalog?.length && <div className="space-y-2">{line.catalog.map((product) => <article key={product.id} className="rounded-xl border bg-card p-3 text-sm">
            <p className="font-semibold leading-snug">{product.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[product.categoryName, product.provider, product.validity].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-primary">{formatRupiah(BigInt(product.sellPrice))}</strong><span className="text-xs text-muted-foreground">Stok {product.stock}</span></div>
            {product.matchConfidence !== 'exact' && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Kemungkinan cocok — periksa nama dan varian.</p>}
            {line.query && saleQuantityFromQuery(line.query) && <Button type="button" size="sm" variant="outline" className="mt-3 min-h-11 w-full" disabled={busy || savingId !== null} onClick={() => void send(`Laku ${product.name} ${saleQuantityFromQuery(line.query!)} pcs`)}>Pakai untuk draf penjualan</Button>}
            {line.query && !line.hasImage && !feedbackDone.includes(line.id) && <button type="button" className="mt-2 block text-xs text-primary underline" disabled={feedbackBusy !== null} onClick={() => void submitFeedback(line, product.id)}>Laporkan kecocokan ke owner</button>}
          </article>)}</div>}
          {line.canFeedback && line.query && !line.hasImage && (feedbackDone.includes(line.id)
            ? <p className="text-xs text-muted-foreground">Terima kasih. Owner akan meninjau masukan ini.</p>
            : <div className="space-y-1"><label htmlFor={`feedback-${line.id}`} className="text-xs text-muted-foreground">Belum tepat? Tulis nama atau ciri barang yang dimaksud.</label><Input id={`feedback-${line.id}`} value={feedbackNotes[line.id] || ''} maxLength={200} onChange={(event) => setFeedbackNotes((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Contoh: charger mobil colokan USB-C" /><Button size="sm" type="button" variant="outline" disabled={!feedbackNotes[line.id]?.trim() || feedbackBusy !== null} onClick={() => void submitFeedback(line)}>{feedbackBusy === line.id ? 'Mengirim...' : 'Kirim koreksi ke owner'}</Button></div>)}
          {canRecordStock && line.stockProposal && <div className="rounded-xl border border-primary/30 bg-card p-3">
            <p className="text-xs font-semibold">Periksa draf cek stok {line.stockProposal.phase === 'buka' ? 'saat buka' : 'saat tutup'}</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{line.stockProposal.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{item.productName}</span><strong className="shrink-0">{item.physicalStock}</strong></div>)}</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Cek nama barang dan jumlahnya. Hasil akan disimpan sebagai catatan; selisih tetap menunggu owner.</p>
            <Button type="button" size="sm" className="mt-3 min-h-11 w-full" disabled={busy || savingId !== null} onClick={() => void confirmStock(line, line.stockProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> Simpan hasil hitung</>}
            </Button>
          </div>}
          {line.saleProposal && <div className="rounded-xl border border-primary/30 bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><ShoppingBag className="h-4 w-4" /> {line.saleProposal.kind === 'create' ? 'Draf penjualan hari ini' : `Koreksi penjualan #${line.saleProposal.saleId}`}</p>
            {!!line.saleProposal.previousItems?.length && <div className="mt-2 rounded-lg bg-muted p-2 text-xs"><p className="font-medium">Catatan lama</p>{line.saleProposal.previousItems.map((item, index) => <p key={index}>{item.name} × {item.qty}</p>)}</div>}
            <div className="mt-2 space-y-2">{line.saleProposal.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-sm"><span>{item.name} × {item.qty}<span className="block text-xs text-muted-foreground">Sisa stok {item.stockAfter} · laba {formatRupiah(BigInt(item.profit))}</span></span><span className="shrink-0 font-medium">{formatRupiah(BigInt(item.unitPrice) * BigInt(item.qty))}</span></div>)}</div>
            <div className="mt-2 space-y-1 border-t pt-2 text-right"><p className="font-semibold">Omzet {formatRupiah(BigInt(line.saleProposal.totalRevenue))}</p><p className="font-semibold text-emerald-700 dark:text-emerald-400">Perkiraan laba {formatRupiah(BigInt(line.saleProposal.totalProfit))} · margin {line.saleProposal.marginPercent}%</p></div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Periksa semua barang dan jumlahnya. Setelah konfirmasi, stok berkurang dan omzet serta laba tercatat.</p>
            <Button type="button" size="sm" className="mt-3 min-h-11 w-full" disabled={busy || savingId !== null} onClick={() => void confirmSale(line, line.saleProposal!)}>
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
            <Button type="button" size="sm" className="mt-3 min-h-11 w-full" disabled={busy || savingId !== null} onClick={() => void confirmCatalog(line, line.catalogProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> {line.catalogProposal.kind === 'create' ? 'Konfirmasi tambah barang' : 'Konfirmasi ubah barang'}</>}
            </Button>
          </div>}
          {!!line.audit?.length && <div className="rounded-xl border bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Hasil periksa katalog</p>
            <div className="mt-2 flex flex-wrap gap-1">{AUDIT_GROUP_ORDER.filter((kind) => (line.auditCounts?.[kind] ?? line.audit!.filter((finding) => finding.kind === kind).length) > 0).map((kind) => <span key={kind} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{AUDIT_KIND_LABELS[kind]} {line.auditCounts?.[kind] ?? line.audit!.filter((finding) => finding.kind === kind).length}</span>)}</div>
            <div className="mt-2 max-h-64 space-y-3 overflow-y-auto">{groupAuditByCategory(line.audit!).map(([category, items]) => <div key={category}>
              <p className="text-[11px] font-semibold text-foreground">{category}</p>
              <div className="mt-1 space-y-0.5">{items.map((finding, index) => <div key={index} className="flex justify-between gap-3 text-xs"><span className="min-w-0 truncate"><span className="text-muted-foreground">{AUDIT_KIND_LABELS[finding.kind]}: </span>{finding.label}</span><span className="shrink-0 text-muted-foreground">{finding.detail}</span></div>)}</div>
            </div>)}</div>
          </div>}
          {line.draft && <div className="rounded-xl border border-amber-300/60 bg-card p-3 text-sm">
            <p className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" /> {line.draft.title}</p>
            <div className="mt-2 space-y-1 text-sm">{line.draft.lines.map((entry, index) => <div key={index} className="flex justify-between gap-3"><span className="text-muted-foreground">{entry.label}</span><strong className={entry.emphasis ? '' : 'font-medium'}>{entry.value}</strong></div>)}</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Periksa nilainya. Data baru berubah setelah Anda menekan tombol ini.</p>
            <Button type="button" size="sm" className="mt-3 min-h-11 w-full" disabled={busy || savingId !== null} onClick={() => void confirmDraft(line, line.draft!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> Konfirmasi</>}
            </Button>
          </div>}
        </div>)}
        {busy && <div role="status" className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Asisten sedang menyiapkan jawaban...</div>}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      </div>
      {image && <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2 text-xs"><img src={image} alt="Foto siap dikirim" className="h-10 w-10 rounded object-cover" /><span className="flex-1">Foto siap dikirim. Pastikan tulisan label terlihat jelas.</span><button type="button" aria-label="Hapus foto" onClick={() => { setImage(null); photoTextRef.current = null; }}><X className="h-4 w-4" /></button></div>}
      <form className="flex shrink-0 items-end gap-2 border-t bg-card px-3 py-3 sm:px-5" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" aria-label="Pilih foto barang" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setImage(await prepareImage(file)); photoTextRef.current = import('@/lib/browser-ocr').then(({ readPhotoText }) => readPhotoText(file)).catch(() => ''); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Foto gagal diproses.'); } event.target.value = ''; }} />
        <Button type="button" size="icon" variant="outline" aria-label="Tambahkan foto barang" disabled={busy} onClick={() => fileRef.current?.click()} className="h-11 w-11 shrink-0 rounded-xl"><ImagePlus className="h-5 w-5" /></Button>
        <textarea ref={inputRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ceritakan apa yang terjadi di toko..." aria-label="Pesan untuk asisten" maxLength={6000} disabled={busy} rows={2} className="min-h-11 max-h-36 min-w-0 flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" />
        <Button type="submit" size="icon" aria-label="Kirim pesan" disabled={busy || (!text.trim() && !image)} className="h-11 w-11 shrink-0 rounded-xl"><Send className="h-5 w-5" /></Button>
      </form>
    </section>;
}
