'use client';

import * as React from 'react';
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ShoppingCart,
  Wallet,
  Receipt,
  User,
} from 'lucide-react';
import { formatRupiah, formatDateTimeID } from '@/lib/utils';
import { ShiftBadge } from '@/components/shift-badge';
import { useToast } from '@/components/ui/toast';
import {
  recordSale,
  recordBiayaAdmin,
  recordExpense,
  closeShift,
} from '@/lib/actions';

type Product = {
  id: number;
  name: string;
  stock: number;
  costPrice: number;
  sellPrice: number;
  categoryId: number;
  categoryName: string;
  subcategoryId: number | null;
  subcategoryName: string | null;
  provider: string | null;
  validity: string | null;
};

type Category = { id: number; name: string; sortOrder: number };
type Subcategory = { id: number; name: string; categoryId: number };

type Sale = {
  id: number;
  createdAt: string;
  totalRevenue: number;
  totalProfit: number;
  userShift: string | null;
  userName: string | null;
  items: { productName: string; qty: number; priceAtSale: number }[];
};
type Service = {
  id: number;
  createdAt: string;
  count: number;
  profit: number;
  userShift: string | null;
  userName: string | null;
};
type Expense = {
  id: number;
  createdAt: string;
  name: string;
  amount: number;
  userShift: string | null;
  userName: string | null;
};

type Summary = {
  totalRevenue: bigint;
  totalProfit: bigint;
  serviceRevenue: bigint;
  serviceProfit: bigint;
  serviceCount: number;
  totalExpense: bigint;
  salesCount: number;
  servicesCount: number;
  expensesCount: number;
};

type Props = {
  isKaryawan: boolean;
  date: string;
  shift: string | null;
  summary: Summary;
  categories: Category[];
  subcategories: Subcategory[];
  products: Product[];
  sales: Sale[];
  services: Service[];
  expenses: Expense[];
};

export function TransaksiClient({
  isKaryawan,
  date,
  shift,
  summary,
  categories,
  subcategories,
  products,
  sales,
  services,
  expenses,
}: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const changeDate = (newDate: string) => {
    const params = new URLSearchParams();
    params.set('date', newDate);
    if (shift) params.set('shift', shift);
    router.push(`/transaksi?${params.toString()}`);
  };
  const changeShift = (newShift: string | null) => {
    const params = new URLSearchParams();
    params.set('date', date);
    if (newShift) params.set('shift', newShift);
    router.push(`/transaksi?${params.toString()}`);
  };

  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const isToday = date === today;
  const totalProfit = summary.totalProfit + summary.serviceProfit;
  const totalRevenue = summary.totalRevenue + summary.serviceRevenue;
  const dateObj = new Date(date + 'T00:00:00');
  const dateLabel = dateObj.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Transaksi</h1>
          <p className="text-xs text-muted-foreground">{isToday ? 'Hari ini' : dateLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={date}
            onChange={(e) => changeDate(e.target.value)}
            className="h-9 w-auto"
          />
          {!isToday && (
            <Button size="sm" variant="outline" onClick={() => changeDate(today)}>
              Hari ini
            </Button>
          )}
        </div>
      </div>

      {isKaryawan && <CloseShiftButton onClosed={() => router.refresh()} />}

      {!isKaryawan && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-muted-foreground">Shift:</span>
          <Button
            size="sm"
            variant={shift === null ? 'default' : 'outline'}
            onClick={() => changeShift(null)}
            className="h-7 text-xs"
          >
            Semua
          </Button>
          <Button
            size="sm"
            variant={shift === 'siang' ? 'default' : 'outline'}
            onClick={() => changeShift('siang')}
            className="h-7 text-xs"
          >
            Siang
          </Button>
          <Button
            size="sm"
            variant={shift === 'malam' ? 'default' : 'outline'}
            onClick={() => changeShift('malam')}
            className="h-7 text-xs"
          >
            Malam
          </Button>
        </div>
      )}

      {isKaryawan ? (
        <div className="rounded-lg border bg-muted p-3 text-center text-xs text-muted-foreground">
          Ringkasan disembunyikan. Silakan input transaksi di bawah.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Omzet</div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {formatRupiah(totalRevenue)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Profit</div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {formatRupiah(totalProfit)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Pengeluaran</div>
            <div className="text-sm font-bold text-rose-600 dark:text-rose-400">
              {formatRupiah(summary.totalExpense)}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <SaleDialog
          categories={categories}
          subcategories={subcategories}
          products={products}
          isKaryawan={isKaryawan}
          onDone={refresh}
        />
        <BiayaAdminDialog onDone={refresh} />
        <ExpenseDialog onDone={refresh} />
      </div>

      {/* Recent Activity */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Aktivitas Terbaru</h2>

        {sales.length === 0 && services.length === 0 && expenses.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Belum ada transaksi
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {sales.map((s) => (
              <Card key={'s' + s.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ShoppingCart className="h-3 w-3" />
                        <span>Penjualan • {formatDateTimeID(s.createdAt)}</span>
                        <ShiftBadge userShift={s.userShift} userName={s.userName} />
                      </div>
                      <div className="mt-0.5 text-sm">
                        {s.items
                          .map((i) => `${i.productName} ×${i.qty}`)
                          .join(', ')}
                      </div>
                    </div>
                    {!isKaryawan && (
                      <div className="text-right">
                        <div className="text-sm font-bold">{formatRupiah(s.totalRevenue)}</div>
                        <div className="text-[10px] text-emerald-600">
                          +{formatRupiah(s.totalProfit)}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {services.map((s) => (
              <Card key={'sv' + s.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Wallet className="h-3 w-3" />
                        <span>Biaya Admin • {formatDateTimeID(s.createdAt)}</span>
                        <ShiftBadge userShift={s.userShift} userName={s.userName} />
                      </div>
                      <div className="mt-0.5 text-sm">
                        {s.count} transaksi
                        {!isKaryawan && (
                          <span className="ml-2 text-emerald-600">+{formatRupiah(s.profit)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {expenses.map((e) => (
              <Card key={'e' + e.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Receipt className="h-3 w-3" />
                        <span>Pengeluaran • {formatDateTimeID(e.createdAt)}</span>
                        <ShiftBadge userShift={e.userShift} userName={e.userName} />
                      </div>
                      <div className="mt-0.5 text-sm">{e.name}</div>
                    </div>
                    {!isKaryawan && (
                      <div className="text-right">
                        <div className="text-sm font-bold text-rose-600">
                          -{formatRupiah(e.amount)}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SALE DIALOG
// ============================================================================
function SaleDialog({
  categories,
  subcategories,
  products,
  isKaryawan,
  onDone,
}: {
  categories: Category[];
  subcategories: Subcategory[];
  products: Product[];
  isKaryawan: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [categoryId, setCategoryId] = React.useState<string>('');
  const [subId, setSubId] = React.useState<string>('all');
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState('');

  const selectedCategory = categories.find((c) => String(c.id) === categoryId);
  const subsForCategory = subcategories.filter((s) => s.categoryId === selectedCategory?.id);

  const productsForCategory = products.filter((p) => p.categoryId === selectedCategory?.id);
  const productsForSub =
    subId === 'all'
      ? productsForCategory
      : productsForCategory.filter((p) => p.subcategoryId === Number(subId));

  const product = productsForSub.find((p) => String(p.id) === productId);
  const qtyN = Number(qty) || 0;
  const total = qtyN * (product?.sellPrice ?? 0);
  const profit = qtyN * ((product?.sellPrice ?? 0) - (product?.costPrice ?? 0));

  const reset = () => {
    setStep(1);
    setCategoryId('');
    setSubId('all');
    setProductId('');
    setQty('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <Button onClick={() => setOpen(true)} className="h-20 flex-col text-xs">
        <ShoppingCart className="mb-1 h-5 w-5" />
        <span>Barang Terjual</span>
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Barang Terjual
            {step > 1 && selectedCategory && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {selectedCategory.name}
              </span>
            )}
            {step === 3 && subId !== 'all' && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {subcategories.find((s) => String(s.id) === subId)?.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-[10px]">
          {(['Kategori', 'Sub', 'Barang'] as const).map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const done = step > n;
            return (
              <React.Fragment key={label}>
                <div
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : done
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <span className="font-semibold">{n}</span>
                  <span>{label}</span>
                </div>
                {i < 2 && <span className="text-muted-foreground">›</span>}
              </React.Fragment>
            );
          })}
        </div>

        {/* STEP 1: Pilih Kategori */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Pilih kategori barang ({productsForCategory.length === 0 ? '0' : productsForCategory.length} barang dengan stok)
            </div>
            {categories.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Belum ada kategori. Tambah di Inventory.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => {
                  const count = products.filter((p) => p.categoryId === c.id).length;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={count === 0}
                      onClick={() => {
                        setCategoryId(String(c.id));
                        setStep(2);
                      }}
                      className="flex flex-col items-start rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <div className="text-sm font-semibold">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {count} barang
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Pilih Subkategori */}
        {step === 2 && selectedCategory && (
          <div className="space-y-3">
            {subsForCategory.length === 0 ? (
              <>
                <div className="text-xs text-muted-foreground">
                  Tidak ada subkategori di {selectedCategory.name}. Langsung pilih barang.
                </div>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setSubId('all');
                    setStep(3);
                  }}
                >
                  Lanjut ({productsForCategory.length} barang)
                </Button>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  Pilih subkategori (atau semua)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSubId('all');
                      setStep(3);
                    }}
                    className="flex flex-col items-start rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="text-sm font-semibold">Semua</div>
                    <div className="text-[10px] text-muted-foreground">
                      {productsForCategory.length} barang
                    </div>
                  </button>
                  {subsForCategory.map((s) => {
                    const count = productsForCategory.filter(
                      (p) => p.subcategoryId === s.id
                    ).length;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={count === 0}
                        onClick={() => {
                          setSubId(String(s.id));
                          setStep(3);
                        }}
                        className="flex flex-col items-start rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <div className="text-sm font-semibold">{s.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {count} barang
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              className="w-full"
            >
              ← Kembali
            </Button>
          </div>
        )}

        {/* STEP 3: Pilih Barang + Qty */}
        {step === 3 && (
          <form
            action={async () => {
              if (!product || qtyN <= 0) return;
              try {
                await recordSale(product.id, qtyN);
                setOpen(false);
                reset();
                onDone();
              } catch (e) {
                alert((e as Error).message);
              }
            }}
            className="space-y-3"
          >
            {productsForSub.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Tidak ada barang dengan stok di sini
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>Pilih Barang</Label>
                  <Select
                    value={productId}
                    onValueChange={setProductId}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih barang..." />
                    </SelectTrigger>
                    <SelectContent>
                      {productsForSub.map((p) => (
                        <SelectItem
                          key={p.id}
                          value={String(p.id)}
                          disabled={p.stock <= 0}
                        >
                          {p.provider
                            ? `${p.provider}${p.validity ? ` (${p.validity})` : ''} • Stok ${p.stock} • ${formatRupiah(p.sellPrice)}`
                            : `${p.name} • Stok ${p.stock} • ${formatRupiah(p.sellPrice)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {product && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Stok saat ini</span>
                      <span className="font-semibold">{product.stock}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Harga</span>
                      <span className="font-semibold">
                        {formatRupiah(product.sellPrice)}
                      </span>
                    </div>
                    {!isKaryawan && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Profit/unit</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatRupiah(product.sellPrice - product.costPrice)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Terjual</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    min={1}
                    max={product?.stock ?? undefined}
                    required
                    autoFocus
                  />
                </div>
                {product && qtyN > 0 && !isKaryawan && (
                  <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                    <div className="flex justify-between">
                      <span className="text-emerald-700 dark:text-emerald-400">Omzet</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        {formatRupiah(total)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Profit (otomatis)
                      </span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">
                        +{formatRupiah(profit)}
                      </span>
                    </div>
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!product || qtyN <= 0 || qtyN > (product?.stock ?? 0)}
                >
                  Catat
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(2)}
              className="w-full"
            >
              ← Kembali
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SERVICE DIALOG (TopUp / Transfer / Withdraw)
// ============================================================================
// BIAYA ADMIN DIALOG (gabungan Top Up, Transfer, Tarik Tunai, dll)
// Input: nama bebas (mis. "Top Up Telkomsel 50rb"), nominal, biaya admin.
// Profit = nominal - biaya admin (otomatis).
// ============================================================================
function BiayaAdminDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState('');
  const [profit, setProfit] = React.useState('');

  const countN = Number(count) || 0;
  const profitN = Number(profit) || 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} className="h-20 flex-col text-xs">
        <Wallet className="mb-1 h-5 w-5" />
        <span>Biaya Admin</span>
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Biaya Admin</DialogTitle>
        </DialogHeader>
        <form
          action={async () => {
            if (countN <= 0 || profitN < 0) return;
            try {
              await recordBiayaAdmin({ count: countN, profit });
              setOpen(false);
              setCount('');
              setProfit('');
              onDone();
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Jumlah Transaksi</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="0"
              required
              min={1}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Total Admin</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={profit}
              onChange={(e) => setProfit(e.target.value)}
              placeholder="0"
              required
              min={0}
            />
            <p className="text-[10px] text-muted-foreground">
              Total admin yang didapat dari semua transaksi di atas
            </p>
          </div>
          {profitN > 0 && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Profit (otomatis)</span>
                <span className="font-bold">+{formatRupiah(profitN)}</span>
              </div>
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={countN <= 0 || profitN < 0}
          >
            Catat
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// EXPENSE DIALOG
// ============================================================================
function CloseShiftButton({ onClosed }: { onClosed: () => void }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    salesCount: number;
    salesRevenue: number;
    salesProfit: number;
    servicesCount: number;
    servicesProfit: number;
    expensesTotal: number;
  } | null>(null);
  const [note, setNote] = React.useState('');

  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Tutup Shift
            </div>
            <div className="text-xs text-amber-700/80 dark:text-amber-400/80">
              Catat ringkasan transaksi hari ini
            </div>
          </div>
          <Button
            size="sm"
            variant="default"
            className="bg-amber-600 hover:bg-amber-700"
            onClick={() => setOpen(true)}
          >
            Tutup Shift
          </Button>
        </div>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tutup Shift</DialogTitle>
          </DialogHeader>
          {result ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Shift ditutup!
                </div>
                <div className="mt-1 space-y-0.5 text-xs">
                  <div>Penjualan: {result.salesCount} transaksi</div>
                  <div>Service: {result.servicesCount} entri</div>
                  <div>Pengeluaran: {result.expensesTotal > 0n ? 'ada' : 'tidak ada'}</div>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  setResult(null);
                  setNote('');
                  onClosed();
                }}
              >
                Selesai
              </Button>
            </div>
          ) : (
            <form
              action={async () => {
                if (!confirm('Tutup shift untuk hari ini?')) return;
                setSubmitting(true);
                try {
                  const r = await closeShift(note);
                  setResult({
                    salesCount: r.salesCount,
                    salesRevenue: Number(r.salesRevenue),
                    salesProfit: Number(r.salesProfit),
                    servicesCount: r.servicesCount,
                    servicesProfit: Number(r.servicesProfit),
                    expensesTotal: Number(r.expensesTotal),
                  });
                  toast({ title: 'Shift berhasil ditutup' });
                } catch (e) {
                  alert((e as Error).message);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="space-y-3"
            >
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="font-medium">Ringkasan akan dicatat:</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  <li>Jumlah penjualan & service hari ini</li>
                  <li>Total omzet & profit</li>
                  <li>Total pengeluaran</li>
                </ul>
              </div>
              <div className="space-y-1">
                <Label>Catatan (opsional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="mis. Shift malam lancar, customer ramai"
                  rows={2}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Konfirmasi Tutup Shift'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ExpenseDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} className="h-20 flex-col text-xs" variant="default">
        <Receipt className="mb-1 h-5 w-5" />
        <span>Pengeluaran</span>
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pengeluaran</DialogTitle>
        </DialogHeader>
        <form
          action={async () => {
            if (!name.trim() || Number(amount) <= 0) return;
            await recordExpense(name, amount);
            setOpen(false);
            setName('');
            setAmount('');
            onDone();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Nama Pengeluaran</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mis. Listrik, Bensin"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Nominal</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              min={1}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Otomatis mengurangi cash saat disimpan
          </p>
          <Button type="submit" className="w-full">
            Simpan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
