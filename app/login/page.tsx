import AuthForm from '@/components/auth-form';
import { currentUser } from '@/app/auth';
import { safeNextPath } from '@/lib/workbench/credentials';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <AuthForm mode="login" next={next} />;
}
