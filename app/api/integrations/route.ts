import { authorize, failure, json } from '@/lib/server/security';
import {
  gateway,
  integrationSession,
  workbenchStatus,
} from '@/lib/server/workbench-provider';
export async function GET(request: Request) {
  try {
    const owner = await authorize(request),
      status = workbenchStatus();
    let connections: unknown[] = [];
    let connectionError: string | null = null;
    if (status.composio)
      try {
        connections = (
          (await gateway().connections(await integrationSession(owner)))
            .items ?? []
        ).map((c) => ({
          slug: c.slug,
          name: c.name,
          connection: { is_active: c.connected_account?.status === 'ACTIVE' },
        }));
      } catch (e) {
        connectionError =
          e instanceof Error ? e.message : 'Could not load connections';
      }
    return json({ ...status, connections, connectionError });
  } catch (e) {
    return failure(e);
  }
}
