'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, ChevronRight, Boxes, Package, AlertTriangle, Pencil, Trash2, Tag, MapPin } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import {
  createCategory,
  createSubcategory,
  createProduct,
  deleteCategory,
  deleteSubcategory,
  deleteProduct,
} from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import type { CategorySummary } from '@/lib/automation';

type Product = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  subcategoryId: number | null;
  subcategoryName: string | null;
  provider: string | null;
  validity: string | null;
  locationId: number | null;
  locationName: string | null;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
};

type Sub = { id: number; categoryId: number; name: string };
type Location = { id: number; name: string; sortOrder: number };

type Props = {
  isKaryawan: boolean;
  categories: CategorySummary[];
  allProducts: Product[];
  subcategories: Sub[];
  locations: Location[];
};

export function InventoryClient({
  isKaryawan,
  categories,
  allProducts,
  subcategories,
  locations,
}: Props) {
  const toast = useToast();
  const [view, setView] = React.useState<'list' | 'category'>('list');
  const [selectedCategory, setSelectedCategory] = React.useState<CategorySummary | null>(null);
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!search.trim()) return allProducts;
    const q = search.toLowerCase();
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.categoryName.toLowerCase().includes(q) ||
        (p.subcategoryName ?? '').toLowerCase().includes(q)
    );
  }, [allProducts, search]);

  const productsInCategory = React.useMemo(() => {
    if (!selectedCategory) return [];
    return filtered.filter((p) => p.categoryId === selectedCategory.id);
  }, [filtered, selectedCategory]);

  const totalProducts = categories.reduce((a, c) => a + c.productCount, 0);
  const totalStock = categories.reduce((a, c) => a + c.totalStock, 0);
  const lowStock = allProducts.filter((p) => p.stock <= p.minStock).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Inventory</h1>
          <p className="text-xs text-muted-foreground">1 modul generik • Kategori = data</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/harga">
            <Button size="icon" variant="outline" title="Daftar Harga">
              <Tag className="h-4 w-4" />
            </Button>
          </Link>
          {!isKaryawan && (
            <AddCategoryDialog onAdded={() => toast({ title: 'Kategori ditambah' })} />
          )}
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Produk</div>
          <div className="text-lg font-bold">{totalProducts}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Total Stok</div>
          <div className="text-lg font-bold">{totalStock}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Menipis</div>
          <div className={`text-lg font-bold ${lowStock > 0 ? 'text-amber-600' : ''}`}>
            {lowStock}
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <>
          <Input
            placeholder="Cari di semua kategori..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-muted/40"
          />
          <div className="space-y-2">
            {categories.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Boxes className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">Belum ada kategori</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Tap tombol + di atas untuk menambah
                  </div>
                </CardContent>
              </Card>
            ) : (
              categories.map((cat) => (
                <Card
                  key={cat.id}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => {
                    setSelectedCategory(cat);
                    setView('category');
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{cat.name}</div>
                          {filtered.some(
                            (p) =>
                              p.categoryId === cat.id &&
                              p.name.toLowerCase().includes(search.toLowerCase())
                          ) &&
                            search && (
                              <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                                {filtered.filter(
                                  (p) =>
                                    p.categoryId === cat.id &&
                                    p.name.toLowerCase().includes(search.toLowerCase())
                                ).length}
                              </span>
                            )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{cat.productCount} produk</span>
                          <span>·</span>
                          <span>Stok {cat.totalStock}</span>
                          {!isKaryawan && (
                            <>
                              <span>·</span>
                              <span>Modal {formatRupiah(cat.totalModal)}</span>
                            </>
                          )}
                        </div>
                        {!isKaryawan && (
                          <div className="mt-1 text-xs">
                            <span className="text-muted-foreground">Jual: </span>
                            <span className="font-semibold">{formatRupiah(cat.totalJual)}</span>
                            <span className="text-muted-foreground"> • Profit: </span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatRupiah(cat.potentialProfit)}
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      ) : (
        <CategoryDetailView
          category={selectedCategory!}
          products={productsInCategory}
          subcategories={subcategories.filter((s) => s.categoryId === selectedCategory!.id)}
          isKaryawan={isKaryawan}
          locations={locations}
          onBack={() => {
            setView('list');
            setSelectedCategory(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// CATEGORY DETAIL
// ============================================================================
function CategoryDetailView({
  category,
  products,
  subcategories,
  isKaryawan,
  locations,
  onBack,
}: {
  category: CategorySummary;
  products: Product[];
  subcategories: Sub[];
  isKaryawan: boolean;
  locations: Location[];
  onBack: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [activeSub, setActiveSub] = React.useState<number | 'all'>('all');

  const filteredProducts =
    activeSub === 'all' ? products : products.filter((p) => p.subcategoryId === activeSub);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Kembali
        </Button>
        {!isKaryawan && (
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={async () => {
                if (confirm(`Hapus kategori "${category.name}"? Semua produk di dalamnya ikut terhapus.`)) {
                  try {
                    await deleteCategory(category.id);
                    toast({ title: 'Kategori dihapus' });
                    onBack();
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Hapus
            </Button>
          </div>
        )}
      </div>
      <div>
        <h2 className="text-lg font-bold">{category.name}</h2>
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border bg-card p-2">
            <div className="text-muted-foreground">Jumlah Produk</div>
            <div className="text-base font-bold">{category.productCount}</div>
          </div>
          <div className="rounded-lg border bg-card p-2">
            <div className="text-muted-foreground">Total Stok</div>
            <div className="text-base font-bold">{category.totalStock}</div>
          </div>
          {isKaryawan ? (
            <>
              <div className="rounded-lg border bg-muted p-2">
                <div className="text-muted-foreground">Nilai Modal</div>
                <div className="text-sm font-bold text-muted-foreground">Rp •••••••</div>
              </div>
              <div className="rounded-lg border bg-muted p-2">
                <div className="text-muted-foreground">Nilai Jual</div>
                <div className="text-sm font-bold text-muted-foreground">Rp •••••••</div>
              </div>
              <div className="col-span-2 rounded-lg border bg-muted p-2">
                <div className="text-xs text-muted-foreground">Keuntungan Potensial</div>
                <div className="text-lg font-bold text-muted-foreground">Rp •••••••</div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border bg-card p-2">
                <div className="text-muted-foreground">Nilai Modal</div>
                <div className="text-sm font-bold">{formatRupiah(category.totalModal)}</div>
              </div>
              <div className="rounded-lg border bg-card p-2">
                <div className="text-muted-foreground">Nilai Jual</div>
                <div className="text-sm font-bold">{formatRupiah(category.totalJual)}</div>
              </div>
              <div className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="text-xs text-emerald-700 dark:text-emerald-400">Keuntungan Potensial</div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {formatRupiah(category.potentialProfit)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={activeSub === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveSub('all')}
        >
          Semua
        </Button>
        {subcategories.map((s) => (
          <Button
            key={s.id}
            variant={activeSub === s.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSub(s.id)}
          >
            {s.name}
          </Button>
        ))}
        {!isKaryawan && <AddSubcategoryDialog categoryId={category.id} />}
        <AddProductDialog
          categoryId={category.id}
          categoryName={category.name}
          isKaryawan={isKaryawan}
          subcategories={subcategories}
          locations={locations}
          defaultSubId={activeSub !== 'all' ? activeSub : undefined}
          onDone={() => {
            router.refresh();
            toast({ title: 'Barang ditambah' });
          }}
        />
      </div>

      <div className="space-y-1.5">
        {filteredProducts.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Belum ada produk di {category.name}
            </CardContent>
          </Card>
        ) : (
          filteredProducts.map((p) => (
            <ProductRow key={p.id} product={p} isKaryawan={isKaryawan} />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PRODUCT ROW
// ============================================================================
function ProductRow({
  product,
  isKaryawan,
}: {
  product: Product;
  isKaryawan: boolean;
}) {
  const low = product.stock <= product.minStock;
  const profit = product.sellPrice - product.costPrice;
  return (
    <Link href={`/inventory/product/${product.id}`} className="block">
      <Card className={low ? 'border-amber-300 dark:border-amber-900' : ''}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="truncate text-sm font-medium">{product.name}</div>
                {low && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                {product.provider && (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {product.provider}
                  </span>
                )}
                {product.validity && (
                  <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    {product.validity}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>Stok: {product.stock}</span>
                {product.subcategoryName && <span>· {product.subcategoryName}</span>}
                {product.locationName && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <MapPin className="h-2.5 w-2.5" />
                    {product.locationName}
                  </span>
                )}
                {!isKaryawan && (
                  <span className="hidden sm:inline">· Profit {formatRupiah(profit)}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              {isKaryawan ? (
                <div className="text-xs text-muted-foreground">Rp •••••</div>
              ) : (
                <>
                  <div className="text-sm font-bold">{formatRupiah(product.sellPrice)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Modal {formatRupiah(product.costPrice)}
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ============================================================================
// DIALOG: ADD CATEGORY
// ============================================================================
function AddCategoryDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="default">
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kategori Baru</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            const n = String(fd.get('name') ?? '');
            if (!n.trim()) return;
            await createCategory(n);
            setOpen(false);
            setName('');
            onAdded();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="cat-name">Nama Kategori</Label>
            <Input
              id="cat-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Aksesoris Mobil"
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full">
            Tambah
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: ADD SUBCATEGORY
// ============================================================================
function AddSubcategoryDialog({ categoryId }: { categoryId: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" /> Sub
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subkategori Baru</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            const n = String(fd.get('name') ?? '');
            if (!n.trim()) return;
            await createSubcategory(categoryId, n);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <Input name="name" placeholder="Contoh: Hydrogel" required autoFocus />
          <Button type="submit" className="w-full">
            Tambah
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: ADD PRODUCT
// ============================================================================
function AddProductDialog({
  categoryId,
  categoryName,
  isKaryawan,
  subcategories,
  locations,
  defaultSubId,
  onDone,
}: {
  categoryId: number;
  categoryName: string;
  isKaryawan: boolean;
  subcategories: Sub[];
  locations: Location[];
  defaultSubId?: number;
  onDone?: () => void;
}) {
  const isVoucher = categoryName === 'Voucher';
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [cost, setCost] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [stock, setStock] = React.useState('0');
  const [minStock, setMinStock] = React.useState('3');
  const [subId, setSubId] = React.useState<string>(defaultSubId ? String(defaultSubId) : 'none');
  const [provider, setProvider] = React.useState<string>('none');
  const [validity, setValidity] = React.useState<string>('Standard');
  const [locationId, setLocationId] = React.useState<string>('none');

  // Hitung lokasi terakhir (paling sering dipakai) dari produk existing
  const recentLocationId = React.useMemo(() => {
    if (locations.length === 0) return null;
    return locations[0]?.id ?? null;
  }, [locations]);

  const profitPreview = (Number(price) || 0) - (Number(cost) || 0);

  // Provider single-mode (Smartfren/By.U/IM3) hanya punya 1 validity
  const singleProviders = ['Smartfren', 'By.U', 'IM3'];
  const isSingleProvider = singleProviders.includes(provider);
  const validityOptions = isSingleProvider ? ['Standard'] : ['3 hari', '5 hari', '7 hari'];
  const providerOptions = ['Telkomsel', 'XL', 'Axis', 'Three', 'Smartfren', 'By.U', 'IM3'];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Barang
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Barang Baru</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            const n = String(fd.get('name') ?? '').trim();
            const c = Number(fd.get('cost') || 0);
            const p = Number(fd.get('price') || 0);
            const s = Number(fd.get('stock') || 0);
            const m = Number(fd.get('minStock') || 3);
            if (!n) return;
            await createProduct({
              name: n,
              categoryId,
              subcategoryId: fd.get('subId') ? Number(fd.get('subId')) : null,
              provider: isVoucher && provider !== 'none' ? provider : null,
              validity: isVoucher ? validity : null,
              locationId: locationId !== 'none' ? Number(locationId) : null,
              costPrice: c,
              sellPrice: p,
              stock: s,
              minStock: m,
            });
            setOpen(false);
            setName('');
            setCost('');
            setPrice('');
            setStock('0');
            setMinStock('3');
            setSubId(defaultSubId ? String(defaultSubId) : 'none');
            setProvider('none');
            setValidity('Standard');
            setLocationId('none');
            onDone?.();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Nama Barang</Label>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Samsung A16 TG"
              required
              autoFocus
            />
          </div>
          {subcategories.length > 0 && (
            <div className="space-y-1">
              <Label>Subkategori</Label>
              <input type="hidden" name="subId" value={subId === 'none' ? '' : subId} />
              <Select value={subId} onValueChange={setSubId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih subkategori (opsional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- Tidak ada -</SelectItem>
                  {subcategories.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isVoucher && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Provider</Label>
                <input type="hidden" name="provider" value={provider === 'none' ? '' : provider} />
                <Select
                  value={provider}
                  onValueChange={(v) => {
                    setProvider(v);
                    if (singleProviders.includes(v)) setValidity('Standard');
                    else setValidity('3 hari');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-</SelectItem>
                    {providerOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Masa Aktif</Label>
                <input type="hidden" name="validity" value={validity} />
                <Select
                  value={validity}
                  onValueChange={setValidity}
                  disabled={isSingleProvider}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {validityOptions.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!isKaryawan && (
              <div className="space-y-1">
                <Label>Modal</Label>
                <Input
                  name="cost"
                  type="number"
                  inputMode="numeric"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="10000"
                  required={!isKaryawan}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>Harga Jual</Label>
              <Input
                name="price"
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="18000"
                required
              />
            </div>
          </div>
          {!isKaryawan && profitPreview > 0 && (
            <div className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              Profit otomatis: <strong>{formatRupiah(profitPreview)}</strong>/unit
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Stok</Label>
              <Input
                name="stock"
                type="number"
                inputMode="numeric"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Lokasi</Label>
                {recentLocationId && locationId === 'none' && (
                  <button
                    type="button"
                    onClick={() => setLocationId(String(recentLocationId))}
                    className="text-[10px] text-emerald-600 hover:underline"
                  >
                    ← Pakai lokasi terakhir
                  </button>
                )}
              </div>
              <input
                type="hidden"
                name="locationId"
                value={locationId === 'none' ? '' : locationId}
              />
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih lokasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- Tidak ada -</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Min Stok</Label>
              <Input
                name="minStock"
                type="number"
                inputMode="numeric"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="3"
              />
            </div>
          </div>
          <Button type="submit" className="w-full">
            Simpan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
