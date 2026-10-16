import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { requireUser } from '@/lib/guard';
import { FeedbackReview } from './review-client';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const user = await requireUser();
  if (user.role !== 'owner') redirect('/');
  return <><AppHeader user={user} /><FeedbackReview /></>;
}
