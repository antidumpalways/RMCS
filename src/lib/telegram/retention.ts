import { prisma } from '@/lib/prisma';

const DAY = 86_400_000;

// Membersihkan data operasional bot yang sudah tidak berguna agar database tidak membengkak.
// Tidak menyentuh rekap shift, posting stok, koreksi, tugas tinjauan, atau draf yang sudah CONFIRMED.
export async function purgeOldTelegramData(now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const updates = await prisma.telegramUpdate.deleteMany({
    where: { status: { in: ['PROCESSED', 'DEAD'] }, updatedAt: { lt: ago(14) } },
  });
  const sessions = await prisma.telegramSession.deleteMany({ where: { expiresAt: { lt: ago(7) } } });
  const drafts = await prisma.telegramDraft.deleteMany({
    where: { status: { in: ['EXPIRED', 'CANCELLED', 'FAILED'] }, updatedAt: { lt: ago(30) } },
  });
  return { updates: updates.count, sessions: sessions.count, drafts: drafts.count };
}
