import ChatWorkspace from '@/components/chat-workspace';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireChatGPTUser('/');
  return <ChatWorkspace />;
}
