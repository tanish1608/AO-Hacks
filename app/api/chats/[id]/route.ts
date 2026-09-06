import { authorize, failure, json } from '@/lib/server/security';
import { loadChat, snapshot } from '@/lib/server/workbench-store';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await authorize(request);
    return json(
      await snapshot(await loadChat((await params).id, owner), owner),
    );
  } catch (e) {
    return failure(e);
  }
}
