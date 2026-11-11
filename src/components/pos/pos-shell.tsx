'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScanBarcode, ReceiptText, Boxes, Clock, Menu as MenuIcon, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logoutAction } from '@/lib/auth-actions';

const tabs = [
  { href: '/kasir', label: 'Kasir', icon: ScanBarcode },
  { href: '/riwayat', label: 'Riwayat', icon: ReceiptText },
  { href: '/stok', label: 'Stok', icon: Boxes },
  { href: '/shift', label: 'Shift', icon: Clock },
  { href: '/menu', label: 'Menu', icon: MenuIcon },
];

export function PosShell({ storeName, username, shift, children }: {
  storeName: string;
  username: string;
  shift: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <header className="shrink-0 border-b bg-card/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight tracking-tight">{storeName} <span className="text-primary">POS</span></h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              <span className="capitalize">Kasir{shift ? ` • Shift ${shift}` : ' • Shift aktif'}</span>
            </p>
          </div>
          <form action={logoutAction} className="flex items-center gap-2 rounded-full border bg-background py-1 pl-3 pr-1 text-xs">
            <span className="max-w-24 truncate font-medium">{username}</span>
            <button type="submit" aria-label="Keluar dari akun" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>

      <nav aria-label="Navigasi kasir" className="shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-20px_hsl(var(--foreground)/0.4)]">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link key={tab.href} href={tab.href} prefetch aria-current={active ? 'page' : undefined}
                className={cn('flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold transition-colors active:scale-95', active ? 'text-primary' : 'text-muted-foreground')}>
                <span className={cn('flex h-7 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-primary/10')}><tab.icon className="h-5 w-5" /></span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
