import { prisma } from '@/lib/prisma';
import { shiftOpening } from '@/lib/automation';

export type ShiftCloseInput = {
  note?: string | null;
  openingCash?: string | number | null;
  actualCash?: string | number | null;
};

function optionalCash(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const amount = BigInt(digits);
  return amount >= 0n && amount <= 1_000_000_000_000n ? amount : null;
}

function resultFromClosure(closure: {
  id: number; salesCount: number; salesRevenue: bigint; salesProfit: bigint; servicesCount: number;
  servicesProfit: bigint; expensesTotal: bigint; openingCash: bigint; cashIn: bigint; cashOut: bigint;
  expectedCash: bigint; actualCash: bigint | null; cashDifference: bigint | null;
  openingStockCount: number; closingStockCount: number; stockDiscrepancyCount: number;
}) {
  return {
    id: closure.id, salesCount: closure.salesCount, salesRevenue: closure.salesRevenue, salesProfit: closure.salesProfit,
    servicesCount: closure.servicesCount, servicesProfit: closure.servicesProfit, expensesTotal: closure.expensesTotal,
    openingCash: Number(closure.openingCash), cashIn: Number(closure.cashIn), cashOut: Number(closure.cashOut),
    expectedCash: Number(closure.expectedCash), actualCash: closure.actualCash === null ? null : Number(closure.actualCash),
    cashDifference: closure.cashDifference === null ? null : Number(closure.cashDifference),
    openingStockCount: closure.openingStockCount, closingStockCount: closure.closingStockCount,
    stockDiscrepancyCount: closure.stockDiscrepancyCount,
  };
}

// Shared by the existing Web Server Action and Telegram confirmation callback.
// telegramDraftId provides a database uniqueness guard for webhook retries.
export async function closeShiftForUser(userId: number, input: ShiftCloseInput = {}, telegramDraftId?: string) {
  if (telegramDraftId) {
    const prior = await prisma.shiftClosure.findUnique({ where: { telegramDraftId } });
    if (prior) return resultFromClosure(prior);
  }
  const me = await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true, shift: true } });
  if (!me) throw new Error('Tidak ada user aktif');
  const now = new Date();
  const opening = await shiftOpening(now);
  const shiftStart = opening.start;
  const where = { createdAt: { gte: shiftStart, lte: now }, userId: me.id };
  const [sales, services, expenses, debtPayments, stockChecks] = await Promise.all([
    prisma.saleTransaction.findMany({ where }),
    prisma.serviceTransaction.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.debtPayment.aggregate({ where, _sum: { amount: true } }),
    prisma.stockOpname.findMany({
      where: { userId: me.id, createdAt: { gte: shiftStart, lte: now }, note: { in: ['Cek stok buka shift', 'Cek stok tutup shift'] } },
      select: { note: true, diff: true, reviewStatus: true },
    }),
  ]);
  const salesRevenue = sales.reduce((sum, row) => sum + row.totalRevenue, 0n);
  const salesProfit = sales.reduce((sum, row) => sum + row.totalProfit, 0n);
  const servicesProfit = services.reduce((sum, row) => sum + row.profit, 0n);
  const expensesTotal = expenses.reduce((sum, row) => sum + row.amount, 0n);
  const debtTotal = debtPayments._sum.amount ?? 0n;
  const openingCash = optionalCash(input.openingCash) ?? opening.openingCash;
  const cashIn = salesRevenue + servicesProfit + debtTotal;
  const cashOut = expensesTotal;
  const expectedCash = openingCash + cashIn - cashOut;
  const actualCash = optionalCash(input.actualCash);
  const cashDifference = actualCash === null ? null : actualCash - expectedCash;
  const openingStockCount = stockChecks.filter((item) => item.note === 'Cek stok buka shift').length;
  const closingStockCount = stockChecks.filter((item) => item.note === 'Cek stok tutup shift').length;
  const stockDiscrepancyCount = stockChecks.filter((item) => item.diff !== 0 && item.reviewStatus === 'PENDING').length;

  const data = {
    userId: me.id, shift: me.shift || 'all', closedAt: now,
    salesCount: sales.length, salesRevenue, salesProfit, servicesCount: services.length, servicesProfit,
    expensesTotal, openingCash, cashIn, cashOut, expectedCash, actualCash, cashDifference,
    openingStockCount, closingStockCount, stockDiscrepancyCount, note: input.note?.trim() || null,
    telegramDraftId: telegramDraftId ?? null,
  };
  try {
    const closure = await prisma.shiftClosure.create({ data, select: { id: true } });
    return resultFromClosure({ id: closure.id, ...data });
  } catch (error) {
    if (telegramDraftId) {
      const prior = await prisma.shiftClosure.findUnique({ where: { telegramDraftId } });
      if (prior) return resultFromClosure(prior);
    }
    throw error;
  }
}
