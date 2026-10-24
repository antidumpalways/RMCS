import { AppHeader } from '@/components/app-header';
import { AssistantChat } from '@/components/assistant-chat';
import { requireUser } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const user = await requireUser();
  return <>
    <AppHeader user={user} />
    <AssistantChat role={user.role} userId={user.id} />
  </>;
}
