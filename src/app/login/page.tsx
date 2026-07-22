import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const me = await getCurrentUser();
  if (me) redirect('/');

  let storeName = 'R CELL';
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (s?.storeName) storeName = s.storeName;
  } catch {}

  return <LoginForm storeName={storeName} />;
}
