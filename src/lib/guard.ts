import { redirect } from 'next/navigation';
import { getCurrentUser, type SessionUser } from './auth';

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  return u;
}
