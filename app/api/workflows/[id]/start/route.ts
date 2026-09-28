import { authorize, failure, json } from '@/lib/server/security';
import { createPublishedSession } from '@/lib/server/workflow-sharing';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await authorize(request, true),
      id = (await params).id;
    const chat = await createPublishedSession(id, owner);
    return json({ chatId: chat.id }, 201);
  } catch (e) {
    return failure(e);
  }
}
