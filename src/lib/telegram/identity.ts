import { prisma } from '@/lib/prisma';
import { parseTelegramOwnerIds } from './core';

export type TelegramActor = {
  identityId: string;
  telegramUserId: bigint;
  displayName: string;
  linkedUserId: number | null;
  isOwner: boolean;
};

export function configuredTelegramOwners(value = process.env.TELEGRAM_OWNER_IDS): Set<string> {
  return parseTelegramOwnerIds(value);
}

export function telegramDisplayName(user: { first_name?: string; last_name?: string; username?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'Karyawan Telegram';
}

export async function identifyTelegramActor(
  user: { id: number; first_name?: string; last_name?: string; username?: string },
  groupId: bigint,
): Promise<TelegramActor | null> {
  if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const telegramUserId = BigInt(user.id);
  const linkedUser = await prisma.user.findUnique({ where: { telegramUserId }, select: { id: true, role: true, active: true } });
  const displayName = telegramDisplayName(user);
  const identity = await prisma.telegramIdentity.upsert({
    where: { telegramUserId },
    create: { telegramUserId, displayName, username: user.username ?? null, lastGroupId: groupId, linkedUserId: linkedUser?.id ?? null },
    update: { displayName, username: user.username ?? null, lastGroupId: groupId, ...(linkedUser ? { linkedUserId: linkedUser.id } : {}) },
    select: { id: true, linkedUserId: true, linkedUser: { select: { role: true, active: true } } },
  });
  const configuredOwner = configuredTelegramOwners().has(telegramUserId.toString());
  return {
    identityId: identity.id,
    telegramUserId,
    displayName,
    linkedUserId: identity.linkedUserId,
    isOwner: configuredOwner || (identity.linkedUser?.active === true && identity.linkedUser.role === 'owner'),
  };
}

