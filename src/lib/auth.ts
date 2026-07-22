// Session cookie sederhana. Untuk production, gunakan NextAuth/JWT.
import { cookies } from 'next/headers';
import { prisma } from './prisma';

const COOKIE_NAME = 'rcms_uid';

export type SessionUser = {
  id: number;
  username: string;
  role: 'owner' | 'karyawan';
  shift: string | null;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
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
