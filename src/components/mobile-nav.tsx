'use client';

import * as React from 'react';
import Link from 'next/link';
import { Home, Package, ArrowRightLeft, FileText, Tag, Wallet, Settings as Cog, ClipboardCheck, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
};

const allItems: NavItem[] = [
  { href: '/', label: 'Ringkasan', icon: Home },
  { href: '/inventory', label: 'Stok', icon: Package },
  { href: '/transaksi', label: 'Transaksi', icon: ArrowRightLeft },
  { href: '/harga', label: 'Harga', icon: Tag },
  { href: '/piutang', label: 'Bon', icon: Wallet },
  { href: '/laporan', label: 'Laporan', icon: FileText, ownerOnly: true },
  { href: '/opname', label: 'Opname', icon: ClipboardCheck, ownerOnly: true },
  { href: '/pengaturan', label: 'Pengaturan', icon: Cog, ownerOnly: true },
];

export function MobileNav({
  isKaryawan,
  pathname,
}: {
  isKaryawan: boolean;
  pathname: string;
}) {
  const items = isKaryawan ? [
    { href: '/', label: 'Beranda', icon: Home },
    { href: '/transaksi', label: 'Riwayat', icon: ArrowRightLeft },
    { href: '/harga', label: 'Harga', icon: Tag },
    { href: '/inventory', label: 'Stok', icon: Package },
    { href: '/piutang', label: 'Bon', icon: Wallet },
  ] : allItems;
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
      <nav aria-label="Navigasi utama" className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', active && 'bg-primary/10')}><it.icon className="h-5 w-5" /></span>
                <span>{it.label}</span>
              </Link>
            );
          })}
          {needsMore && (
            <button
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                isOverflowActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MoreHorizontal className={cn('h-5 w-5', isOverflowActive && 'text-primary')} />
              <span>Lainnya</span>
            </button>
          )}
        </div>
      </nav>

      {needsMore && (
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Menu Lainnya</DialogTitle><DialogDescription>Kelola toko dan lihat catatan usaha.</DialogDescription></DialogHeader>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
