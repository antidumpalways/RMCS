'use server';

import { redirect } from 'next/navigation';
import { prisma } from './prisma';
import { clearSession, setSessionUser } from './auth';

// Rate limit in-memory (sufficient untuk 1 toko, ganti Redis jika multi-store)
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 menit

function checkRateLimit(username: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = failedAttempts.get(username);
  if (record && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }
  if (record && record.lockedUntil <= now) {
    failedAttempts.delete(username);
  }
  return { allowed: true };
}

function recordFailed(username: string) {
  const now = Date.now();
  const record = failedAttempts.get(username);
  const newCount = (record?.count ?? 0) + 1;
  if (newCount >= MAX_ATTEMPTS) {
    failedAttempts.set(username, { count: newCount, lockedUntil: now + LOCK_DURATION_MS });
  } else {
    failedAttempts.set(username, { count: newCount, lockedUntil: 0 });
  }
}

function clearAttempts(username: string) {
  failedAttempts.delete(username);
}

export async function loginAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim().toLowerCase();
  const pin = String(formData.get('pin') ?? '').trim();
  if (!username || !pin) {
    throw new Error('Username dan PIN wajib diisi');
  }

  // Rate limit check
  const limit = checkRateLimit(username);
  if (!limit.allowed) {
    throw new Error(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((limit.retryAfter ?? 300) / 60)} menit`);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  // Generic error untuk hindari user enumeration
  if (!user || !user.active || user.pin !== pin) {
    recordFailed(username);
    throw new Error('Username atau PIN salah');
  }
  clearAttempts(username);
  await setSessionUser(user.id);
  redirect('/');
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
}
