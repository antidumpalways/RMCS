import { Prisma } from '@prisma/client';

export async function setCombinedBalance(tx: Prisma.TransactionClient, input: {
  targetBalance: bigint;
  expectedBalance?: bigint;
  createdById: number | null;
  sourceDraftId?: string;
  note?: string | null;
}) {
  const settings = await tx.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, storeName: 'R CELL', cashInitial: 0n, balanceInitial: 0n },
  });
  const [sales, services, debtPayments, expenses] = await Promise.all([
    tx.saleTransaction.aggregate({ _sum: { totalRevenue: true } }),
    tx.serviceTransaction.aggregate({ _sum: { profit: true } }),
    tx.debtPayment.aggregate({ _sum: { amount: true } }),
    tx.expense.aggregate({ _sum: { amount: true } }),
  ]);
  const cashNet = (sales._sum.totalRevenue ?? 0n) + (services._sum.profit ?? 0n)
    + (debtPayments._sum.amount ?? 0n) - (expenses._sum.amount ?? 0n);
  const previousBalance = settings.cashInitial + cashNet + settings.balanceInitial;
  if (input.expectedBalance !== undefined && previousBalance !== input.expectedBalance) {
    throw new Error('Saldo berubah sejak draf dibuat. Minta asisten cek ulang agar selisihnya tidak salah.');
  }
  const delta = input.targetBalance - previousBalance;
  await tx.settings.update({ where: { id: 1 }, data: { balanceInitial: settings.balanceInitial + delta } });
  await tx.balanceAdjustment.create({
    data: {
      account: 'TOTAL',
      previousBalance,
      newBalance: input.targetBalance,
      delta,
      note: input.note ?? null,
      createdById: input.createdById,
      sourceDraftId: input.sourceDraftId ?? null,
    },
  });
  return { previousBalance, newBalance: input.targetBalance, delta };
}