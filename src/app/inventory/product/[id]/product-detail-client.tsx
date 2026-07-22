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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Minus, Pencil, Trash2, ArrowLeft, MapPin } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import {
  addStock,
  recordSale,
  updateProduct,
  deleteProduct,
} from '@/lib/actions';
import { useToast } from '@/components/ui/toast';

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

type Cat = { id: number; name: string };
type Sub = { id: number; categoryId: number; name: string };
type Loc = { id: number; name: string };

export function ProductDetailClient({
  product,
  categories,
  subcategories,
  locations,
  isKaryawan,
}: {
  product: Product;
  categories: Cat[];
  subcategories: Sub[];
  locations: Loc[];
  isKaryawan: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const profit = product.sellPrice - product.costPrice;
  const low = product.stock <= product.minStock;

  return (
    <div className="space-y-4">
      <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Inventory
      </Link>

      <div>
        <h1 className="text-xl font-bold">{product.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{product.categoryName}</span>
          {product.subcategoryName && <span>• {product.subcategoryName}</span>}
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
          {product.locationName && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <MapPin className="h-2.5 w-2.5" />
              {product.locationName}
            </span>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Stok</div>
              <div className={`text-2xl font-bold ${low ? 'text-amber-600' : ''}`}>
                {product.stock}
              </div>
            </div>
            {!isKaryawan && (
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Modal</div>
                <div className="text-sm font-bold">{formatRupiah(product.costPrice)}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Jual</div>
              <div className="text-sm font-bold">{formatRupiah(product.sellPrice)}</div>
            </div>
          </div>
          {!isKaryawan && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-2 text-center text-sm dark:bg-emerald-950/30">
              <div className="text-xs text-emerald-700 dark:text-emerald-400">Profit / unit (otomatis)</div>
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                {formatRupiah(profit)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <AddStockDialog
          productId={product.id}
          productName={product.name}
          onDone={() => {
            router.refresh();
            toast({ title: 'Stok ditambah' });
          }}
        />
        <SellDialog
          productId={product.id}
          productName={product.name}
          currentStock={product.stock}
          sellPrice={product.sellPrice}
          onDone={() => {
            router.refresh();
            toast({ title: 'Penjualan dicatat' });
          }}
        />
      </div>

      {!isKaryawan && (
        <div className="grid grid-cols-2 gap-2">
          <EditProductDialog
            product={product}
            categories={categories}
            subcategories={subcategories}
            locations={locations}
            onDone={() => {
              router.refresh();
              toast({ title: 'Produk diperbarui' });
            }}
          />
          <DeleteProductButton
            productId={product.id}
            productName={product.name}
            onDone={() => {
              toast({ title: 'Produk dihapus' });
              router.push('/inventory');
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ADD STOCK
// ============================================================================
function AddStockDialog({
  productId,
  productName,
  onDone,
}: {
  productId: number;
  productName: string;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [qty, setQty] = React.useState('');
  const [cost, setCost] = React.useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="outline">
        <Plus className="mr-1 h-4 w-4" /> Barang Masuk
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Barang Masuk</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{productName}</div>
        <form
          action={async (fd) => {
            const q = Number(fd.get('qty') || 0);
            const c = Number(fd.get('cost') || 0);
            const sup = String(fd.get('supplier') ?? '');
            const n = String(fd.get('note') ?? '');
            if (q <= 0 || c < 0) return;
            try {
              await addStock({
                productId,
                qty: q,
                costPerUnit: c,
                supplier: sup || undefined,
                note: n || undefined,
              });
              setOpen(false);
              setQty('');
              setCost('');
              onDone();
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Jumlah</Label>
            <Input
              name="qty"
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              autoFocus
              required
              min={1}
            />
          </div>
          <div className="space-y-1">
            <Label>Harga Beli / unit</Label>
            <Input
              name="cost"
              type="number"
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
              required
              min={0}
            />
            <p className="text-[10px] text-muted-foreground">
              Otomatis jadi modal baru produk
            </p>
          </div>
          <div className="space-y-1">
            <Label>Supplier (opsional)</Label>
            <Input name="supplier" placeholder="mis. Surya, Distro A" />
          </div>
          <div className="space-y-1">
            <Label>Catatan (opsional)</Label>
            <Input name="note" placeholder="Mis. Stok awal, Restock" />
          </div>
          <Button type="submit" className="w-full">
            Tambah Stok
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SELL
// ============================================================================
function SellDialog({
  productId,
  productName,
  currentStock,
  sellPrice,
  onDone,
}: {
  productId: number;
  productName: string;
  currentStock: number;
  sellPrice: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [qty, setQty] = React.useState('');
  const qtyN = Number(qty) || 0;
  const total = qtyN * sellPrice;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Minus className="mr-1 h-4 w-4" /> Barang Terjual
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Penjualan</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {productName} • Stok: {currentStock}
        </div>
        <form
          action={async (fd) => {
            const q = Number(fd.get('qty') || 0);
            if (q <= 0) return;
            try {
              await recordSale(productId, q);
              setOpen(false);
              setQty('');
              onDone();
            } catch (e) {
              toast({ title: 'Gagal', description: (e as Error).message, variant: 'destructive' });
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Terjual</Label>
            <Input
              name="qty"
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              autoFocus
              required
              min={1}
              max={currentStock}
            />
          </div>
          {qtyN > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <div className="flex justify-between">
                <span>Total Omzet</span>
                <span className="font-bold">{formatRupiah(total)}</span>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={qtyN > currentStock || qtyN <= 0}>
            Catat
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// (alert fallback removed; using toast above)

// ============================================================================
// EDIT PRODUCT
// ============================================================================
function EditProductDialog({
  product,
  categories,
  subcategories,
  locations,
  onDone,
}: {
  product: Product;
  categories: Cat[];
  subcategories: Sub[];
  locations: Loc[];
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(product.name);
  const [categoryId, setCategoryId] = React.useState(String(product.categoryId));
  const [subId, setSubId] = React.useState(product.subcategoryId ? String(product.subcategoryId) : 'none');
  const [provider, setProvider] = React.useState(product.provider || 'none');
  const [validity, setValidity] = React.useState(product.validity || 'Standard');
  const [locationId, setLocationId] = React.useState(product.locationId ? String(product.locationId) : 'none');
  const [cost, setCost] = React.useState(String(product.costPrice));
  const [price, setPrice] = React.useState(String(product.sellPrice));
  const [minStock, setMinStock] = React.useState(String(product.minStock));
  const profit = (Number(price) || 0) - (Number(cost) || 0);

  const isVoucher = product.categoryName === 'Voucher';
  const singleProviders = ['Smartfren', 'By.U', 'IM3'];
  const isSingleProvider = singleProviders.includes(provider);
  const validityOptions = isSingleProvider ? ['Standard'] : ['3 hari', '5 hari', '7 hari'];
  const providerOptions = ['Telkomsel', 'XL', 'Axis', 'Three', 'Smartfren', 'By.U', 'IM3'];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="outline">
        <Pencil className="mr-1 h-4 w-4" /> Edit
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Produk</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await updateProduct(product.id, {
              name: String(fd.get('name') || product.name),
              categoryId: Number(fd.get('categoryId') || product.categoryId),
              subcategoryId: fd.get('subId') ? Number(fd.get('subId')) : null,
              provider: isVoucher && provider !== 'none' ? provider : null,
              validity: isVoucher ? validity : null,
              locationId: locationId !== 'none' ? Number(locationId) : null,
              costPrice: Number(fd.get('cost') || 0),
              sellPrice: Number(fd.get('price') || 0),
              minStock: Number(fd.get('minStock') || 3),
            });
            setOpen(false);
            onDone();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Nama</Label>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Kategori</Label>
            <input type="hidden" name="categoryId" value={categoryId} />
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue />
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
          {subcategories.length > 0 && (
            <div className="space-y-1">
              <Label>Subkategori</Label>
              <input type="hidden" name="subId" value={subId === 'none' ? '' : subId} />
              <Select value={subId} onValueChange={setSubId}>
                <SelectTrigger>
                  <SelectValue placeholder="-" />
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
                    <SelectValue placeholder="-" />
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
            <div className="space-y-1">
              <Label>Modal</Label>
              <Input
                name="cost"
                type="number"
                inputMode="numeric"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Harga Jual</Label>
              <Input
                name="price"
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          {profit > 0 && (
            <div className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              Profit/unit: <strong>{formatRupiah(profit)}</strong> (otomatis)
            </div>
          )}
          <div className="space-y-1">
            <Label>Lokasi</Label>
            <input
              type="hidden"
              name="locationId"
              value={locationId === 'none' ? '' : locationId}
            />
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="-" />
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
            <Label>Minimal Stok</Label>
            <Input
              name="minStock"
              type="number"
              inputMode="numeric"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full">
            Simpan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DELETE
// ============================================================================
function DeleteProductButton({
  productId,
  productName,
  onDone,
}: {
  productId: number;
  productName: string;
  onDone: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="text-destructive"
      onClick={async () => {
        if (confirm(`Hapus ${productName}?`)) {
          await deleteProduct(productId);
          onDone();
        }
      }}
    >
      <Trash2 className="mr-1 h-4 w-4" /> Hapus
    </Button>
  );
}
