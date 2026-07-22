'use client';

import Link from 'next/link';
import { Home, Package, ArrowRightLeft, FileText, Tag, Wallet, Settings as Cog, ClipboardCheck } from 'lucide-react';
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
  const cols = items.length;
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div
        className="mx-auto grid max-w-2xl"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== '/' && pathname.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <it.icon className={cn('h-5 w-5', active && 'text-primary')} />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
