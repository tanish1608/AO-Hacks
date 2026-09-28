import AuthForm from '@/components/auth-form';
import { currentUser } from '@/app/auth';
import { safeNextPath } from '@/lib/workbench/credentials';
import { redirect } from 'next/navigation';
import { googleConfigured } from '@/lib/server/google';
export const dynamic = 'force-dynamic';
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = typeof params.error === 'string' ? params.error : '';
  if (await currentUser()) redirect(next);
  return (
    <AuthForm mode="signup" next={next} google={googleConfigured()} error={error} />
  );
}
