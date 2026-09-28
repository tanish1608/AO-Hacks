import { authorize, failure, HttpError, json } from '@/lib/server/security';
import { loadPublication } from '@/lib/server/workflow-sharing';
import { database } from '@/lib/server/store';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const row = await loadPublication((await params).id),
      p = row.publication;
    return json({
      id: row.id,
      title: p.title,
      description: p.description,
      createdAt: p.createdAt,
      steps: p.workflow.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        role: n.role,
        toolkits: n.toolkits,
        dependsOn: n.dependsOn,
      })),
      apps: [...new Set(p.workflow.nodes.flatMap((n) => n.toolkits))],
      available: row.uses < row.max_uses,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await authorize(request, true),
      id = (await params).id;
    const result = await database()
      .prepare(
        'UPDATE workflow_publications SET revoked=1 WHERE id=? AND owner_id=?',
      )
      .bind(id, owner)
      .run();
    if (!result.meta.changes)
      throw new HttpError(404, 'Workflow link not found.');
    return json({ revoked: true });
  } catch (e) {
    return failure(e);
  }
}
