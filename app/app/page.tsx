import ChatWorkspace from '@/components/chat-workspace';
import { requireUser } from '@/app/auth';
export const dynamic = 'force-dynamic';
export default async function Workspace({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (
    typeof params.task === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(params.task)
  )
    query.set('task', params.task);
  if (params.settings === 'connections') query.set('settings', 'connections');
  const user = await requireUser(query.size ? '/app?' + query.toString() : '/app');
  return <ChatWorkspace accountName={user.name} accountEmail={user.email} />;
}
