'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, CheckCircle2, AlertCircle, Search, ClipboardCheck, Trash2 } from 'lucide-react';
import { recordStockOpname, applyStockOpname, deleteStockOpname } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import { formatDateTimeID } from '@/lib/utils';

type Product = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  systemStock: number;
};

type Opname = {
  id: number;
  productName: string;
  systemStock: number;
  physicalStock: number;
  diff: number;
  note: string | null;
  userName: string | null;
  createdAt: string;
};

type Props = {
  products: Product[];
  opnames: Opname[];
};

export function OpnameClient({ products, opnames }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = React.useState('');
  const [activeCat, setActiveCat] = React.useState<number | 'all'>('all');

  const categories = React.useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const p of products) {
      const cur = map.get(p.categoryId);
      if (cur) cur.count++;
      else map.set(p.categoryId, { id: p.categoryId, name: p.categoryName, count: 1 });
    }
    return Array.from(map.values());
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = products;
    if (activeCat !== 'all') list = list.filter((p) => p.categoryId === activeCat);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(s));
    }
    return list;
  }, [products, q, activeCat]);

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>
      <div>
        <h1 className="text-xl font-bold">Stok Opname</h1>
        <p className="text-xs text-muted-foreground">
          Audit stok: input hasil hitung fisik, sistem hitung selisih
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari produk..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={activeCat === 'all' ? 'default' : 'outline'}
          onClick={() => setActiveCat('all')}
          className="h-7 text-xs"
        >
          Semua ({products.length})
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={activeCat === c.id ? 'default' : 'outline'}
            onClick={() => setActiveCat(c.id)}
            className="h-7 text-xs"
          >
            {c.name} ({c.count})
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Tidak ada produk
            </CardContent>
          </Card>
        ) : (
          filtered.map((p) => <OpnameRow key={p.id} product={p} onAdded={() => router.refresh()} />)
        )}
      </div>

      {opnames.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Riwayat Opname</h2>
          {opnames.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      {o.diff === 0 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : o.diff < 0 ? (
                        <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      <span className="font-medium">{o.productName}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDateTimeID(o.createdAt)}
                      {o.userName && ` · ${o.userName}`}
                    </div>
                    {o.note && <div className="text-xs text-muted-foreground">{o.note}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs">
                      Sistem: <strong>{o.systemStock}</strong> → Fisik: <strong>{o.physicalStock}</strong>
                    </div>
                    <div
                      className={`text-sm font-bold ${
                        o.diff === 0
                          ? 'text-emerald-600'
                          : o.diff < 0
                            ? 'text-rose-600'
                            : 'text-amber-600'
                      }`}
                    >
                      {o.diff > 0 ? `+${o.diff}` : o.diff}
                    </div>
                  </div>
                </div>
                {o.diff !== 0 && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={async () => {
                        if (
                          confirm(
                            `Terapkan hasil opname? Stok ${o.productName} jadi ${o.physicalStock}`
                          )
                        ) {
                          await applyStockOpname(o.id);
                          toast({ title: 'Stok diupdate' });
                          router.refresh();
                        }
                      }}
                    >
                      Terapkan
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={async () => {
                        if (confirm('Hapus catatan opname ini?')) {
                          await deleteStockOpname(o.id);
                          router.refresh();
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OpnameRow({ product, onAdded }: { product: Product; onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [physical, setPhysical] = React.useState('');
  const [note, setNote] = React.useState('');

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{product.name}</div>
          <div className="text-xs text-muted-foreground">
            {product.categoryName} · Stok sistem: <strong>{product.systemStock}</strong>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <ClipboardCheck className="mr-1 h-4 w-4" /> Hitung
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Stok Opname</DialogTitle>
            </DialogHeader>
            <div className="text-sm">
              <strong>{product.name}</strong>
              <div className="text-xs text-muted-foreground">
                Stok di sistem: {product.systemStock}
              </div>
            </div>
            <form
              action={async () => {
                const p = Number(physical);
                if (isNaN(p) || p < 0) return;
                await recordStockOpname({
                  productId: product.id,
                  physicalStock: p,
                  note: note || undefined,
                });
                setOpen(false);
                setPhysical('');
                setNote('');
                onAdded();
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <Label>Hasil Hitung Fisik</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={physical}
                  onChange={(e) => setPhysical(e.target.value)}
                  placeholder="0"
                  required
                  min={0}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label>Catatan (opsional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="mis. Selisih karena 1 unit rusak"
                  rows={2}
                />
              </div>
              <Button type="submit" className="w-full">
                Simpan Hasil
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
