import PublicWorkflow from '@/components/public-workflow';
import LockedWorkflow from '@/components/locked-workflow';
import { currentUser } from '@/app/auth';
export const dynamic = 'force-dynamic';
export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  // Shared links are account-only: running one creates a private session that
  // spends model budget and uses the visitor's own connected accounts. Show the
  // locked page rather than bouncing to /login, so the person can see they
  // followed a real link before being asked to sign up.
  return (await currentUser()) ? (
    <PublicWorkflow id={id} signedIn />
  ) : (
    <LockedWorkflow id={id} />
  );
}
