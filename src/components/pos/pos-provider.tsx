'use client';

import * as React from 'react';
import type { PosProduct } from '@/lib/pos-data';

type Cart = Record<number, number>;

type PosContext = {
  products: PosProduct[];
  popularIds: number[];
  cart: Cart;
  count: number;
  total: number;
  setQty: (id: number, qty: number) => void;
  add: (id: number) => void;
  clearCart: () => void;
  /** Kurangi stok lokal setelah penjualan tersimpan, supaya layar langsung akurat. */
  applySold: (lines: { id: number; qty: number }[]) => void;
};

const Ctx = React.createContext<PosContext | null>(null);

export function usePos() {
  const value = React.useContext(Ctx);
  if (!value) throw new Error('usePos harus dipakai di dalam PosProvider');
  return value;
}

export function PosProvider({ products: serverProducts, popularIds, children }: {
  products: PosProduct[];
  popularIds: number[];
  children: React.ReactNode;
}) {
  const [products, setProducts] = React.useState(serverProducts);
  const [cart, setCart] = React.useState<Cart>({});

  // Sinkronkan saat layout memuat ulang data dari server (mis. setelah router.refresh()).
  React.useEffect(() => { setProducts(serverProducts); }, [serverProducts]);

  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const setQty = React.useCallback((id: number, qty: number) => {
    setCart((current) => {
      const stock = byId.get(id)?.stock ?? 0;
      const next = { ...current };
      const clamped = Math.min(Math.max(0, qty), stock);
      if (clamped <= 0) delete next[id]; else next[id] = clamped;
      return next;
    });
  }, [byId]);

  const add = React.useCallback((id: number) => {
    setCart((current) => {
      const stock = byId.get(id)?.stock ?? 0;
      const qty = (current[id] ?? 0) + 1;
      if (qty > stock) return current;
      return { ...current, [id]: qty };
    });
  }, [byId]);

  const clearCart = React.useCallback(() => setCart({}), []);

  const applySold = React.useCallback((lines: { id: number; qty: number }[]) => {
    const sold = new Map(lines.map((l) => [l.id, l.qty]));
    setProducts((current) => current.map((p) => sold.has(p.id) ? { ...p, stock: Math.max(0, p.stock - (sold.get(p.id) ?? 0)) } : p));
  }, []);

  const { count, total } = React.useMemo(() => {
    let c = 0;
    let t = 0;
    for (const [id, qty] of Object.entries(cart)) {
      c += qty;
      t += (byId.get(Number(id))?.sellPrice ?? 0) * qty;
    }
    return { count: c, total: t };
  }, [cart, byId]);

  const value = React.useMemo(
    () => ({ products, popularIds, cart, count, total, setQty, add, clearCart, applySold }),
    [products, popularIds, cart, count, total, setQty, add, clearCart, applySold]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
