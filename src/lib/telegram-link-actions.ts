'use server';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function createTelegramLinkCode(userId: number, ownerPin: string) {
  const current = await getCurrentUser();
  if (!current || current.role !== 'owner') throw new Error('Hanya owner yang dapat menautkan akun Telegram.');
  const owner = await prisma.user.findUnique({ where: { id: current.id }, select: { pin: true, role: true } });
  const pinMatches = !!owner && owner.role === 'owner' && typeof ownerPin === 'string' && /^\d{4,6}$/.test(ownerPin) && ownerPin.length === owner.pin.length &&
    timingSafeEqual(Buffer.from(owner.pin), Buffer.from(ownerPin));
  if (!pinMatches) throw new Error('PIN owner salah.');
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Akun pengguna tidak valid.');
  const user = await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true, username: true } });
  if (!user) throw new Error('Pengguna aktif tidak ditemukan.');
  const code = randomBytes(24).toString('base64url');
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.user.update({ where: { id: user.id }, data: { telegramLinkCodeHash: codeHash, telegramLinkExpiresAt: expiresAt } });
  return { code, username: user.username, expiresAt: expiresAt.toISOString() };
}
