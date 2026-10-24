import Link from 'next/link';
import { headers } from 'next/headers';
import { GlobalSearch } from './global-search';
import { MobileNav } from './mobile-nav';
import { AssistantChat } from './assistant-chat';
import { LogOut, Store } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { logoutAction } from '@/lib/auth-actions';

export async function AppHeader({ user }: { user?: { id: number; username: string; role: string; shift: string | null } }) {
  let storeName = 'R CELL';
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (s?.storeName) storeName = s.storeName;
  } catch {
    // ignore
  }
  const isKaryawan = user?.role === 'karyawan';
  const h = await headers();
  const pathname = h.get('x-pathname') ?? h.get('x-invoke-path') ?? h.get('next-url') ?? '/';
  return (
    <>
      <header className="sticky top-0 z-30 -mx-4 mb-5 space-y-3 border-b border-border/70 bg-background/90 px-4 pb-3 pt-3 shadow-[0_8px_24px_-22px_hsl(var(--foreground)/0.28)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:static sm:mx-0 sm:mb-6 sm:rounded-2xl sm:border sm:bg-card/80 sm:px-4 sm:py-3 sm:shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-md shadow-primary/20">
              <Store className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-bold leading-tight tracking-tight">{storeName}</div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Operasional Toko
              </div>
            </div>
          </Link>
          {user && (
            <form action={logoutAction}>
              <div className="flex items-center gap-2 rounded-full border bg-background/70 py-1 pl-3 pr-1 text-xs">
                <span className="max-w-28 truncate font-medium text-foreground">{user.username}</span>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Keluar dari akun"
                  title="Keluar"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}
        </div>
        {!(isKaryawan && pathname === '/') && <GlobalSearch />}
      </header>
      <MobileNav isKaryawan={isKaryawan} pathname={pathname} />
      {user && <AssistantChat role={user.role} />}
    </>
  );
}
