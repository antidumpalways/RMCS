import { AppHeader } from '@/components/app-header';
import { PiutangClient } from './piutang-client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guard';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function PiutangPage() {
  const me = await requireUser();
  const isKaryawan = me.role === 'karyawan';
  const debts = await prisma.debt.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      user: { select: { username: true, shift: true } },
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });
  return (
    <>
      <AppHeader user={me} />
      <PiutangClient
        isKaryawan={isKaryawan}
        debts={debts.map((d) => ({
          id: d.id,
          customer: d.customer,
          amount: Number(d.amount),
          paid: Number(d.paid),
          description: d.description,
          status: d.status,
          userShift: d.user?.shift ?? null,
          userName: d.user?.username ?? null,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          payments: d.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            note: p.note,
            createdAt: p.createdAt.toISOString(),
          })),
        }))}
      />
    </>
  );
}
