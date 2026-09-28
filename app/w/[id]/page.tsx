import PublicWorkflow from '@/components/public-workflow';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <PublicWorkflow
      id={(await params).id}
      signedIn={Boolean(await getChatGPTUser())}
    />
  );
}
