'use server';

import { redirect } from 'next/navigation';
import { prisma } from './prisma';
import { clearSession, setSessionUser } from './auth';

export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim();
  const pin = String(formData.get('pin') ?? '').trim();
  if (!username || !pin) {
    throw new Error('Username dan PIN wajib diisi');
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    throw new Error('Username tidak ditemukan');
  }
  if (user.pin !== pin) {
    throw new Error('PIN salah');
  }
  await setSessionUser(user.id);
  redirect('/');
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
}
