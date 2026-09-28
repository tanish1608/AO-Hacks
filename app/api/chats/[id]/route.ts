import { authorize, failure, HttpError, json } from '@/lib/server/security';
import { listRuns, loadChat, snapshot } from '@/lib/server/workbench-store';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await authorize(request);
    const id = (await params).id;
    // `?run=` fetches one run with its full step log. The snapshot omits traces
    // for older runs, so this is how the results view loads one on demand.
    const runId = new URL(request.url).searchParams.get('run');
    if (runId) {
      const run = (await listRuns(id, owner)).find((r) => r.id === runId);
      if (!run) throw new HttpError(404, 'Run not found');
      return json({ run });
    }
    return json(await snapshot(await loadChat(id, owner), owner));
  } catch (e) {
    return failure(e);
  }
}
