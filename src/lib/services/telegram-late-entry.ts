import { prisma } from '@/lib/prisma';
import { applyExtraction, emptyRecap, extractRecapMessage, recapTotals } from '@/lib/telegram/recap';
import { planLateEntry } from '@/lib/telegram/late-entry-plan';
import { setCombinedBalance } from '@/lib/services/combined-balance';
import { resolveInventoryMappings } from '@/lib/services/telegram-inventory';

export type LateEntryResult =
  | { status: 'APPLIED'; lines: Array<{ name: string; qty: number; stockAfter: number }>; itemMoney: bigint; balanceDelta: bigint; balanceAfter: bigint | null }
  | { status: 'NEEDS_OWNER'; reason: string }
  | { status: 'DUPLICATE' };

class LateEntryRefused extends Error {}

// Penjualan/uang yang terlewat setelah rekap ditutup: stok dipotong dan saldo disesuaikan langsung (semua atau tidak sama sekali).
export async function applyLateEntry(input: {
  reportId: string; chatId: bigint; identityId: string; linkedUserId: number | null; displayName: string; content: string; updateId: string;
}): Promise<LateEntryResult> {
  const extraction = await extractRecapMessage(input.content, emptyRecap());
  const draft = applyExtraction(emptyRecap(), extraction, input.content, 'late-' + input.updateId);
  if (draft.unresolved.length) return { status: 'NEEDS_OWNER', reason: draft.unresolved[0] };
  if (!draft.entries.length && !(draft.inventoryLines?.length)) return { status: 'NEEDS_OWNER', reason: 'isi susulan tidak terbaca' };
  if (draft.entries.some(entry => entry.category === 'total_balance' || entry.category === 'cash_balance' || entry.category === 'electronic_balance')) {
    return { status: 'NEEDS_OWNER', reason: 'saldo akhir tidak bisa disusulkan' };
  }
  const mapped = await resolveInventoryMappings(draft);
  const lines = mapped.inventoryLines ?? [];
  const totals = recapTotals(draft);
  const moneyDelta = BigInt(totals.sale) + BigInt(totals.service_fee) - BigInt(totals.expense);
  if (lines.some(line => line.mappingStatus !== 'MATCHED' || !line.productId)) return { status: 'NEEDS_OWNER', reason: 'barang belum dipastikan, tulis nama lengkap' };

  try {
    return await prisma.$transaction(async tx => {
      const productRows = await tx.product.findMany({ where: { id: { in: [...new Set(lines.map(line => line.productId!))] } }, select: { id: true, name: true, stock: true, sellPrice: true, costPrice: true } });
      const plan = planLateEntry(lines, moneyDelta, productRows);
      if (plan.status === 'REFUSED') throw new LateEntryRefused(plan.reason);
      const costById = new Map(productRows.map(product => [product.id, product.costPrice]));
      const applied: Array<{ name: string; qty: number; stockAfter: number }> = [];
      for (const group of plan.groups) {
        const updated = await tx.product.updateMany({ where: { id: group.product.id, stock: { gte: group.qty } }, data: { stock: { decrement: group.qty } } });
        if (updated.count !== 1) throw new LateEntryRefused('stok ' + group.product.name + ' tidak cukup');
        const movement = await tx.inventoryMovement.create({ data: { productId: group.product.id, type: 'TELEGRAM_LATE_ENTRY', qty: -group.qty,
          costAtTime: costById.get(group.product.id) ?? 0n, note: ('Susulan Telegram ' + input.reportId + '; ' + input.content).slice(0, 300),
          userId: input.linkedUserId, telegramIdentityId: input.identityId }, select: { id: true } });
        await tx.telegramInventoryPosting.create({ data: { operationKey: `${input.reportId}:late:${input.updateId}:${group.product.id}`, reportId: input.reportId,
          lineId: `late-${input.updateId}-${group.product.id}`, productId: group.product.id, sourceText: group.sources.join(' | ').slice(0, 2000),
          productLabel: group.labels.join(' / ').slice(0, 500), reportedQty: group.qty, webAppQty: 0, coverage: 'UNRECORDED_ONLY', appliedQty: group.qty, movementId: movement.id } });
        applied.push({ name: group.product.name, qty: group.qty, stockAfter: group.product.stock - group.qty });
      }
      let balanceAfter: bigint | null = null;
      if (plan.balanceDelta !== 0n) {
        const result = await setCombinedBalance(tx, { deltaBalance: plan.balanceDelta, createdById: input.linkedUserId,
          note: ('Susulan Telegram ' + input.reportId + ': ' + input.content).slice(0, 300) });
        balanceAfter = result.newBalance;
      }
      // Catatan audit; kunci unik ini juga mencegah susulan yang sama diterapkan dua kali bila Telegram mengulang pesan.
      await tx.telegramOwnerReviewTask.create({ data: { operationKey: 'late-entry:' + input.updateId, kind: 'LATE_ENTRY', status: 'REVIEWED', chatId: input.chatId,
        telegramIdentityId: input.identityId, reportId: input.reportId, reviewedAt: new Date(),
        payload: { summary: 'Karyawan: ' + input.displayName + '\nSusulan otomatis: ' + input.content.slice(0, 300), applied: applied.map(item => `${item.name} -${item.qty}`), balanceDelta: plan.balanceDelta.toString() } } });
      return { status: 'APPLIED' as const, lines: applied, itemMoney: plan.itemMoney, balanceDelta: plan.balanceDelta, balanceAfter };
    }, { isolationLevel: 'Serializable', timeout: 20_000 });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return { status: 'DUPLICATE' };
    if (error instanceof LateEntryRefused) return { status: 'NEEDS_OWNER', reason: error.message };
    throw error;
  }
}
