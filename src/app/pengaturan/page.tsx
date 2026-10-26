import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { PengaturanClient } from './pengaturan-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';
import { TelegramLinking } from './telegram-linking';

export const dynamic = 'force-dynamic';

export default async function PengaturanPage() {
  const me = await requireUser();
  if (me.role === 'karyawan') redirect('/');
  const isKaryawan = false;
  let settings = {
    storeName: 'R CELL',
    cashInitial: 0n,
    balanceInitial: 0n,
    theme: 'system',
  };
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (s) {
      settings = {
        storeName: s.storeName,
        cashInitial: s.cashInitial,
        balanceInitial: s.balanceInitial,
        theme: s.theme,
      };
    }
  } catch {
    // ignore
  }
  const telegramUsers = await prisma.user.findMany({ where: { active: true }, select: { id: true, username: true, role: true, shift: true }, orderBy: { username: 'asc' } });
  return (
    <>
      <AppHeader user={me} />
      <div className="space-y-4">
      <PengaturanClient
        isKaryawan={isKaryawan}
        settings={{
          storeName: settings.storeName,
          cashInitial: Number(settings.cashInitial),
          balanceInitial: Number(settings.balanceInitial),
          theme: settings.theme,
        }}
      />
      <TelegramLinking users={telegramUsers} />
      </div>
    </>
  );
}
