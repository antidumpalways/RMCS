import Link from 'next/link';
import { headers } from 'next/headers';
import { GlobalSearch } from './global-search';
import { MobileNav } from './mobile-nav';
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
      <header className="mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-bold leading-tight">{storeName}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Management System
              </div>
            </div>
          </Link>
          {user && (
            <form action={logoutAction}>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{user.username}</span>
                <button
                  type="submit"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Keluar"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}
        </div>
        <GlobalSearch />
      </header>
      <MobileNav isKaryawan={isKaryawan} pathname={pathname} />
    </>
  );
}
