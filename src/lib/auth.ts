// Session cookie sederhana. Untuk production, gunakan NextAuth/JWT.
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { AsyncLocalStorage } from 'node:async_hooks';

const COOKIE_NAME = 'rcms_uid';

export type SessionUser = {
  id: number;
  username: string;
  role: 'owner' | 'karyawan';
  shift: string | null;
};

const telegramOwnerContext = new AsyncLocalStorage<SessionUser>();

export function withTelegramOwnerUser<T>(user: SessionUser, run: () => Promise<T>) {
  if (user.role !== 'owner') throw new Error('Akses owner diperlukan.');
  return telegramOwnerContext.run(user, run);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const telegramOwner = telegramOwnerContext.getStore();
  if (telegramOwner) return telegramOwner;
  const store = await cookies();
  const uid = store.get(COOKIE_NAME)?.value;
  if (!uid) return null;
  const n = Number(uid);
  if (!Number.isInteger(n)) return null;
  const user = await prisma.user.findUnique({ where: { id: n } });
  if (!user || !user.active) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role as 'owner' | 'karyawan',
    shift: user.shift,
  };
}

export async function setSessionUser(id: number) {
  const store = await cookies();
  store.set(COOKIE_NAME, String(id), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 hari
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function maskValue(value: number | bigint): string {
  return 'Rp ••••••••';
}

