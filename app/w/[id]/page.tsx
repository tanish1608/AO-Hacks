import PublicWorkflow from '@/components/public-workflow';
import { requireUser } from '@/app/auth';
export const dynamic = 'force-dynamic';
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  // Shared links are account-only: running one creates a private session that
  // spends model budget and uses the visitor's own connected accounts.
  await requireUser(`/w/${id}`);
  return <PublicWorkflow id={id} signedIn />;
}
