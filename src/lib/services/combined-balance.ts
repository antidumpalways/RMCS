import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type CombinedBalanceReader = Pick<Prisma.TransactionClient, 'saleTransaction' | 'serviceTransaction' | 'debtPayment' | 'expense' | 'balanceAdjustment'>;

export async function recordedCombinedMovementsBetween(db: CombinedBalanceReader, from: Date, to: Date) {
  const where = { createdAt: { gte: from, lte: to } };
  const [sales, services, payments, expenses, adjustments] = await Promise.all([
    db.saleTransaction.aggregate({ where, _sum: { totalRevenue: true } }),
    db.serviceTransaction.aggregate({ where, _sum: { profit: true } }),
    db.debtPayment.aggregate({ where, _sum: { amount: true } }),
    db.expense.aggregate({ where, _sum: { amount: true } }),
    db.balanceAdjustment.aggregate({ where: { ...where, account: { in: ['CASH', 'ELECTRONIC', 'TOTAL'] } }, _sum: { delta: true } }),
  ]);
  const movement = {
    sales: sales._sum.totalRevenue ?? 0n,
    serviceFees: services._sum.profit ?? 0n,
    debtPayments: payments._sum.amount ?? 0n,
    expenses: expenses._sum.amount ?? 0n,
    adjustments: adjustments._sum.delta ?? 0n,
  };
  return { ...movement, net: movement.sales + movement.serviceFees + movement.debtPayments - movement.expenses + movement.adjustments };
}

export async function combinedBalanceAt(date: Date): Promise<bigint> {
  return prisma.$transaction(async tx => {
    const settings = await tx.settings.upsert({
      where: { id: 1 }, update: {},
      create: { id: 1, storeName: 'R CELL', cashInitial: 0n, balanceInitial: 0n },
    });
    const before = { createdAt: { lt: date } };
    const [sales, services, payments, expenses, laterAdjustments] = await Promise.all([
      tx.saleTransaction.aggregate({ where: before, _sum: { totalRevenue: true } }),
      tx.serviceTransaction.aggregate({ where: before, _sum: { profit: true } }),
      tx.debtPayment.aggregate({ where: before, _sum: { amount: true } }),
      tx.expense.aggregate({ where: before, _sum: { amount: true } }),
      tx.balanceAdjustment.aggregate({ where: { account: 'TOTAL', createdAt: { gte: date } }, _sum: { delta: true } }),
    ]);
    const cashAtStart = settings.cashInitial + (sales._sum.totalRevenue ?? 0n) + (services._sum.profit ?? 0n)
      + (payments._sum.amount ?? 0n) - (expenses._sum.amount ?? 0n);
    const electronicAtStart = settings.balanceInitial - (laterAdjustments._sum.delta ?? 0n);
    return cashAtStart + electronicAtStart;
  }, { isolationLevel: 'RepeatableRead' });
}
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
