'use client';

import * as React from 'react';
import Link from 'next/link';
import { Home, Package, ArrowRightLeft, FileText, Tag, Wallet, Settings as Cog, ClipboardCheck, MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
};

const allItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/transaksi', label: 'Transaksi', icon: ArrowRightLeft },
  { href: '/harga', label: 'Cek', icon: Tag },
  { href: '/piutang', label: 'Bon', icon: Wallet },
  { href: '/laporan', label: 'Laporan', icon: FileText, ownerOnly: true },
  { href: '/opname', label: 'Opname', icon: ClipboardCheck, ownerOnly: true },
  { href: '/pengaturan', label: 'Atur', icon: Cog, ownerOnly: true },
];

export function MobileNav({
  isKaryawan,
  pathname,
}: {
  isKaryawan: boolean;
  pathname: string;
}) {
  const items = isKaryawan ? allItems.filter((i) => !i.ownerOnly) : allItems;
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Karyawan = 5 item pas, Owner = 8 → tampil 4 + More (5 kolom total) biar 44px touch target
  const MAX_VISIBLE = 4;
  const needsMore = items.length > 5;
  const visibleItems = needsMore ? items.slice(0, MAX_VISIBLE) : items;
  const overflowItems = needsMore ? items.slice(MAX_VISIBLE) : [];
  const cols = needsMore ? MAX_VISIBLE + 1 : items.length;
  const isOverflowActive = overflowItems.some(
    (it) => pathname === it.href || (it.href !== '/' && pathname.startsWith(it.href))
  );

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div
          className="mx-auto grid max-w-2xl"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {visibleItems.map((it) => {
            const active = pathname === it.href || (it.href !== '/' && pathname.startsWith(it.href));
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <it.icon className={cn('h-5 w-5', active && 'text-primary')} />
                <span>{it.label}</span>
              </Link>
            );
          })}
          {needsMore && (
            <button
              onClick={() => setMoreOpen(true)}
              className={cn(
                'flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                isOverflowActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MoreHorizontal className={cn('h-5 w-5', isOverflowActive && 'text-primary')} />
              <span>Lainnya</span>
            </button>
          )}
        </div>
      </nav>

      {needsMore && moreOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="relative mx-auto w-full max-w-2xl animate-in slide-in-from-bottom rounded-t-xl border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Menu Lainnya</div>
              <button onClick={() => setMoreOpen(false)} className="rounded-full p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {overflowItems.map((it) => {
                const active = pathname === it.href || (it.href !== '/' && pathname.startsWith(it.href));
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-card hover:bg-muted'
                    )}
                  >
                    <it.icon className="h-6 w-6" />
                    <span>{it.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="h-3" />
          </div>
        </div>
      )}
    </>
  );
}
