'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';
import { bulkUpdatePrices } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import { formatRupiah } from '@/lib/utils';

type Cat = { id: number; name: string; productCount: number };
type Sub = { id: number; name: string; categoryId: number; productCount: number };

export function BulkPriceClient({
  categories,
  subcategories,
}: {
  categories: Cat[];
  subcategories: Sub[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = React.useState<'all' | 'category' | 'subcategory'>('all');
  const [categoryId, setCategoryId] = React.useState<string>('');
  const [subcategoryId, setSubcategoryId] = React.useState<string>('');
  const [margin, setMargin] = React.useState('30');
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ updated: number } | null>(null);

  const subsForCategory = subcategories.filter((s) => s.categoryId === Number(categoryId));

  const getProductCount = (): number => {
    if (scope === 'all') return categories.reduce((a, c) => a + c.productCount, 0);
    if (scope === 'category')
      return categories.find((c) => c.id === Number(categoryId))?.productCount ?? 0;
    return subcategories.find((s) => s.id === Number(subcategoryId))?.productCount ?? 0;
  };

  const handleSubmit = async () => {
    const m = Number(margin);
    if (isNaN(m) || m < 0) {
      toast({ title: 'Margin tidak valid', variant: 'destructive' });
      return;
    }
    if (scope === 'category' && !categoryId) {
      toast({ title: 'Pilih kategori', variant: 'destructive' });
      return;
    }
    if (scope === 'subcategory' && !subcategoryId) {
      toast({ title: 'Pilih subkategori', variant: 'destructive' });
      return;
    }
    if (!confirm(`Update harga jual semua produk (margin ${m}%)?`)) return;
    setSubmitting(true);
    try {
      const r = await bulkUpdatePrices({
        scope,
        categoryId: scope !== 'all' ? Number(categoryId) : undefined,
        subcategoryId: scope === 'subcategory' ? Number(subcategoryId) : undefined,
        marginPercent: m,
      });
      setResult(r);
      toast({ title: `${r.updated} produk diupdate` });
      router.refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/harga" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Cek Barang
      </Link>
      <div>
        <h1 className="text-xl font-bold">Update Harga Massal</h1>
        <p className="text-xs text-muted-foreground">
          Set margin % dari modal → harga jual otomatis
        </p>
      </div>

      {result && (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                Berhasil update {result.updated} produk
              </div>
              <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
                Harga jual dihitung dari modal × (1 + {margin}%), dibulatkan ke Rp 500
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Pengaturan Margin
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Cakupan</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['all', 'category', 'subcategory'] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={scope === s ? 'default' : 'outline'}
                  onClick={() => setScope(s)}
                >
                  {s === 'all' ? 'Semua' : s === 'category' ? 'Kategori' : 'Subkategori'}
                </Button>
              ))}
            </div>
          </div>

          {scope === 'category' && (
            <div className="space-y-1">
              <Label>Kategori</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} ({c.productCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scope === 'subcategory' && (
            <>
              <div className="space-y-1">
                <Label>Kategori</Label>
                <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setSubcategoryId(''); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Subkategori</Label>
                <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder={categoryId ? 'Pilih subkategori' : 'Pilih kategori dulu'} />
                  </SelectTrigger>
                  <SelectContent>
                    {subsForCategory.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name} ({s.productCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label>Margin (%)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              min={0}
              max={1000}
            />
            <p className="text-[10px] text-muted-foreground">
              Modal Rp 10.000 × {margin || 0}% = {formatRupiah(10000 * (1 + (Number(margin) || 0) / 100))} (dibulatkan ke Rp 500)
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="mr-1 inline h-3 w-3" />
            <strong>{getProductCount()} produk</strong> akan diupdate. Tindakan ini tidak bisa dibatalkan.
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full" size="lg">
            {submitting ? 'Memproses...' : `Update ${getProductCount()} Produk`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
