import { prisma } from '@/lib/prisma';

// Jejak "sebelum" untuk perubahan produk yang dijalankan langsung oleh asisten owner, agar bisa dibatalkan satu ketukan.
export type ProductSnapshot = {
  id: number; name: string; sku: string | null; provider: string | null; validity: string | null;
  categoryId: number; subcategoryId: number | null; locationId: number | null; minStock: number;
  costPrice: string; sellPrice: string; stock: number;
};
type UndoPayload = {
  version: 1; ownerId: string; label: string; startedAt: string; before: ProductSnapshot[];
  afterUpdatedAt: Record<string, string>; created: Array<{ name: string; categoryId: number }>;
};

export const UNDO_TTL_MS = 60 * 60_000;

export async function snapshotProducts(ids: number[]): Promise<ProductSnapshot[]> {
  if (!ids.length) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, sku: true, provider: true, validity: true, categoryId: true, subcategoryId: true, locationId: true, minStock: true, costPrice: true, sellPrice: true, stock: true } });
  return rows.map(row => ({ ...row, costPrice: row.costPrice.toString(), sellPrice: row.sellPrice.toString() }));
}

// Dipanggil sesudah perubahan tersimpan: mencatat keadaan sesudahnya (untuk mendeteksi perubahan lanjutan) dan membuat catatan batal.
export async function recordUndo(input: { chatId: bigint; ownerId: number; label: string; startedAt: Date; before: ProductSnapshot[]; created: Array<{ name: string; categoryId: number }> }) {
  if (!input.before.length && !input.created.length) return null;
  const after = await prisma.product.findMany({ where: { id: { in: input.before.map(item => item.id) } }, select: { id: true, updatedAt: true } });
  const payload: UndoPayload = { version: 1, ownerId: String(input.ownerId), label: input.label.slice(0, 200), startedAt: input.startedAt.toISOString(), before: input.before,
    afterUpdatedAt: Object.fromEntries(after.map(item => [String(item.id), item.updatedAt.toISOString()])), created: input.created };
  const row = await prisma.telegramDraft.create({ data: { chatId: input.chatId, kind: 'OWNER_UNDO', status: 'PENDING', payload: payload as object,
    expiresAt: new Date(Date.now() + UNDO_TTL_MS) }, select: { id: true } });
  return row.id;
}

export async function latestUndoId(chatId: bigint): Promise<string | null> {
  const row = await prisma.telegramDraft.findFirst({ where: { chatId, kind: 'OWNER_UNDO', status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  return row?.id ?? null;
}

function parseUndo(value: unknown, ownerId: number): UndoPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<UndoPayload>;
  if (payload.version !== 1 || payload.ownerId !== String(ownerId) || !Array.isArray(payload.before) || !Array.isArray(payload.created) ||
      typeof payload.startedAt !== 'string' || !payload.afterUpdatedAt || typeof payload.afterUpdatedAt !== 'object') return null;
  return payload as UndoPayload;
}

export type UndoResult = { status: 'OK' | 'USED' | 'INVALID'; label: string; restored: string[]; removed: string[]; skipped: string[] };

export async function applyUndo(chatId: bigint, ownerId: number, undoId: string): Promise<UndoResult> {
  const empty = { label: '', restored: [], removed: [], skipped: [] };
  const row = await prisma.telegramDraft.findUnique({ where: { id: undoId } });
  const payload = row && row.kind === 'OWNER_UNDO' && row.chatId === chatId ? parseUndo(row.payload, ownerId) : null;
  if (!row || !payload) return { status: 'INVALID', ...empty };
  const claimed = await prisma.telegramDraft.updateMany({ where: { id: undoId, kind: 'OWNER_UNDO', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return { status: 'USED', ...empty, label: payload.label };

  const restored: string[] = [], removed: string[] = [], skipped: string[] = [];
  for (const before of payload.before) {
    try {
      await prisma.$transaction(async tx => {
        const current = await tx.product.findUnique({ where: { id: before.id } });
        if (!current) { skipped.push(`${before.name} (sudah dihapus)`); return; }
        if (current.updatedAt.toISOString() !== payload.afterUpdatedAt[String(before.id)]) { skipped.push(`${current.name} (sudah berubah lagi sejak itu)`); return; }
        await tx.product.update({ where: { id: before.id }, data: { name: before.name, sku: before.sku, provider: before.provider, validity: before.validity,
          categoryId: before.categoryId, subcategoryId: before.subcategoryId, locationId: before.locationId, minStock: before.minStock,
          costPrice: BigInt(before.costPrice), sellPrice: BigInt(before.sellPrice), stock: before.stock } });
        if (current.stock !== before.stock) {
          await tx.inventoryMovement.create({ data: { productId: before.id, type: 'OWNER_UNDO', qty: before.stock - current.stock, costAtTime: BigInt(before.costPrice),
            note: ('Pembatalan: ' + payload.label).slice(0, 300) } });
        }
        restored.push(before.name);
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
    } catch {
      skipped.push(`${before.name} (gagal dikembalikan)`);
    }
  }
  for (const made of payload.created) {
    try {
      await prisma.$transaction(async tx => {
        const product = await tx.product.findFirst({ where: { name: { equals: made.name, mode: 'insensitive' }, categoryId: made.categoryId, createdAt: { gte: new Date(new Date(payload.startedAt).getTime() - 60_000) } },
          include: { _count: { select: { inventoryMovements: true, saleItems: true, telegramInventoryPostings: true } } } });
        if (!product) { skipped.push(`${made.name} (tidak ditemukan)`); return; }
        if (product._count.inventoryMovements > 1 || product._count.saleItems > 0 || product._count.telegramInventoryPostings > 0) {
          skipped.push(`${product.name} (sudah dipakai, tidak dihapus)`); return;
        }
        await tx.product.delete({ where: { id: product.id } });
        removed.push(product.name);
      }, { isolationLevel: 'Serializable', timeout: 15_000 });
    } catch {
      skipped.push(`${made.name} (gagal dihapus)`);
    }
  }
  await prisma.telegramDraft.update({ where: { id: undoId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
  return { status: 'OK', label: payload.label, restored, removed, skipped };
}

export function formatUndoResult(result: UndoResult): string {
  const nl = String.fromCharCode(10);
  if (result.status === 'USED') return 'Perubahan itu sudah dibatalkan sebelumnya atau batas waktu batalnya (60 menit) sudah lewat.';
  if (result.status === 'INVALID') return 'Catatan pembatalan tidak ditemukan.';
  const lines = ['↩️ Dibatalkan' + (result.label ? ': ' + result.label : '')];
  if (result.restored.length) lines.push('Dikembalikan: ' + result.restored.join(', '));
  if (result.removed.length) lines.push('Dihapus (produk baru): ' + result.removed.join(', '));
  if (result.skipped.length) lines.push('⚠️ Dilewati: ' + result.skipped.join('; '));
  if (!result.restored.length && !result.removed.length) lines.push('Tidak ada yang berubah.');
  return lines.join(nl);
}
