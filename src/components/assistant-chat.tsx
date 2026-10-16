'use client';

import * as React from 'react';
import { Bot, CheckCircle2, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { recordShiftStockCheck } from '@/lib/actions';
import { formatRupiah } from '@/lib/utils';

type CatalogProduct = {
  id: number;
  name: string;
  categoryName: string;
  provider: string | null;
  validity: string | null;
  sellPrice: string;
  stock: number;
};
type StockProposal = {
  phase: 'buka' | 'tutup';
  items: { productId: number; productName: string; physicalStock: number }[];
};
type ChatLine = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  catalog?: CatalogProduct[];
  stockProposal?: StockProposal | null;
};

export function AssistantChat({ role }: { role: string }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [lines, setLines] = React.useState<ChatLine[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const canRecordStock = role === 'karyawan';

  React.useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, lines, busy]);

  const send = async (value = text) => {
    const content = value.trim();
    if (!content || busy) return;
    const userLine: ChatLine = { id: crypto.randomUUID(), role: 'user', content };
    const next = [...lines, userLine];
    setLines(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-12).map(({ role: messageRole, content: messageContent }) => ({ role: messageRole, content: messageContent })) }),
      });
      const result = await response.json() as {
        message?: string;
        catalog?: CatalogProduct[];
        stockProposal?: StockProposal | null;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Asisten sedang tidak tersedia.');
      setLines((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.message || 'Saya belum bisa membantu untuk pertanyaan itu.',
        catalog: result.catalog,
        stockProposal: result.stockProposal,
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesan belum terkirim. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const confirmStock = async (line: ChatLine, proposal: StockProposal) => {
    if (savingId) return;
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
      setSavingId(null);
    }
  };

  return <>
    {open && <section aria-label="Asisten R CELL" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex h-[min(72dvh,620px)] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:right-6" role="dialog" aria-modal="false">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span><div><h2 className="text-sm font-semibold">Asisten R CELL</h2><p className="text-[11px] text-muted-foreground">AI DeepSeek · harga sesuai katalog</p></div></div>
        <Button type="button" size="icon" variant="ghost" aria-label="Tutup chat" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {!lines.length && <div className="space-y-3 pt-2">
          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-muted p-3 text-sm">Halo! Saya bisa bantu mencari harga sesuai katalog toko atau menyiapkan catatan cek stok.</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Berapa harga barang ...?')}>Cari harga</button>
            {canRecordStock && <button type="button" className="min-h-10 rounded-full border px-3 text-xs hover:bg-muted" onClick={() => void send('Saya mau catat stok saat tutup toko. Tolong tanya barang dan jumlahnya dulu.')}>Catat stok</button>}
          </div>
        </div>}
        {lines.map((line) => <div key={line.id} className={`space-y-2 ${line.role === 'user' ? 'ml-auto max-w-[90%]' : 'mr-auto max-w-[95%]'}`}>
          <div className={`whitespace-pre-wrap rounded-2xl p-3 text-sm leading-relaxed ${line.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted'}`}>{line.content}</div>
          {!!line.catalog?.length && <div className="space-y-2">{line.catalog.map((product) => <article key={product.id} className="rounded-xl border bg-card p-3 text-sm">
            <p className="font-semibold leading-snug">{product.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[product.categoryName, product.provider, product.validity].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-primary">{formatRupiah(BigInt(product.sellPrice))}</strong><span className="text-xs text-muted-foreground">Stok {product.stock}</span></div>
          </article>)}</div>}
          {canRecordStock && line.stockProposal && <div className="rounded-xl border border-primary/30 bg-card p-3">
            <p className="text-xs font-semibold">Periksa draf cek stok {line.stockProposal.phase === 'buka' ? 'saat buka' : 'saat tutup'}</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{line.stockProposal.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-xs"><span className="min-w-0 truncate">{item.productName}</span><strong className="shrink-0">{item.physicalStock}</strong></div>)}</div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Cek nama barang dan jumlahnya. Hasil akan disimpan sebagai catatan; selisih tetap menunggu owner.</p>
            <Button type="button" size="sm" className="mt-3 w-full" disabled={savingId !== null} onClick={() => void confirmStock(line, line.stockProposal!)}>
              {savingId === line.id ? <><Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" /> Simpan hasil hitung</>}
            </Button>
          </div>}
        </div>)}
        {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Asisten sedang mencari...</div>}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      </div>
      <form className="flex items-center gap-2 border-t bg-background p-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Tanya harga atau cek stok..." aria-label="Pesan untuk asisten" maxLength={700} disabled={busy} />
        <Button type="submit" size="icon" aria-label="Kirim pesan" disabled={busy || !text.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </section>}
    {!open && <Button type="button" size="icon" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-50 h-14 w-14 rounded-full shadow-lg sm:bottom-6 sm:right-6" aria-label="Buka asisten R CELL" aria-expanded={open} onClick={() => setOpen(true)}>
      <MessageCircle className="h-6 w-6" />
    </Button>}
  </>;
}
