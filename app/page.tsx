import Landing from '@/components/landing';
import { currentUser } from '@/app/auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  return <Landing signedIn={Boolean(await currentUser())} />;
}
