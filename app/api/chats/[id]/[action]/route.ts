import {
  authorize,
  failure,
  HttpError,
  json,
  readJson,
} from '@/lib/server/security';
import {
  leaseChat,
  listRuns,
  loadChat,
  releaseChat,
  saveChat,
  snapshot,
} from '@/lib/server/workbench-store';
import { dependencies } from '@/lib/server/workbench-provider';
import {
  advanceChatRun,
  design,
  executePending,
  startRun,
} from '@/lib/workbench/engine';
import { validateWorkflow } from '@/lib/workbench/validation';
import { digest } from '@/lib/engine/runtime';
import type { Run } from '@/lib/workbench/types';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  let token: string | undefined,
    owner: string | undefined,
    id: string | undefined;
  try {
    owner = await authorize(request, true);
    const p = await params;
    id = p.id;
    const b = await readJson(request);
    let chat = await loadChat(id, owner);
    if (b.revision !== chat.revision)
      throw new HttpError(409, 'Chat changed. Refresh before continuing.');
    const allowed = [
      'message',
      'run',
      'advance',
      'pause',
      'resume',
      'approve',
      'reject',
      'reconcile',
      'node',
      'settings',
      'memory',
    ];
    if (!allowed.includes(p.action)) throw new HttpError(404, 'Unknown action');
    token = await leaseChat(chat, owner);
    const runs = await listRuns(id, owner);
    let run: Run | undefined = b.runId
      ? runs.find((r) => r.id === b.runId)
      : undefined;
    const active = runs.find((r) =>
      ['running', 'paused', 'awaiting_approval'].includes(r.status),
    );
    if (
      ['message', 'node', 'settings', 'memory', 'run'].includes(p.action) &&
      active
    )
      throw new HttpError(
        409,
        'Finish or stop the current run before changing the workflow.',
      );
    const unresolved = runs.find(
      (r) => r.pending && ['unknown', 'executing'].includes(r.pending.status),
    );
    if (p.action === 'run' && unresolved)
      throw new HttpError(
        409,
        'Reconcile the previous external action before starting another run.',
      );
    if (p.action === 'message') {
      if (
        typeof b.message !== 'string' ||
        !b.message.trim() ||
        b.message.length > 12000
      )
        throw new HttpError(400, 'Message must be 1–12,000 characters.');
      chat = await design(chat, b.message, await dependencies(owner, chat), []);
    } else if (p.action === 'node') {
      const previous = chat.versions.at(-1);
      if (!previous) throw new HttpError(409, 'Design a workflow first');
      const workflow = structuredClone(previous.workflow);
      const node = workflow.nodes.find((n) => n.id === b.nodeId);
      if (!node) throw new HttpError(404, 'Agent not found');
      if (
        typeof b.instruction !== 'string' ||
        !b.instruction.trim() ||
        b.instruction.length > 4000
      )
        throw new HttpError(
          400,
          'Agent instruction must be 1–4,000 characters.',
        );
      node.instruction = b.instruction;
      const validated = validateWorkflow(workflow);
      chat.versions.push({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        workflow: validated,
        digest: await digest(validated),
        reason: 'User edited ' + node.name,
      });
      chat.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: `Updated **${node.name}**. The new instruction will apply to your next run.`,
      });
    } else if (p.action === 'settings') {
      if (
        typeof b.target !== 'number' ||
        b.target < 0.5 ||
        b.target > 1 ||
        !Number.isInteger(b.maxIterations) ||
        b.maxIterations < 1 ||
        b.maxIterations > 8 ||
        !Number.isInteger(b.maxToolCalls) ||
        b.maxToolCalls < 1 ||
        b.maxToolCalls > 60
      )
        throw new HttpError(
          400,
          'Target must be 50–100%, attempts 1–8, and tool budget 1–60.',
        );
      chat.settings = {
        target: b.target,
        maxIterations: b.maxIterations,
        maxToolCalls: b.maxToolCalls,
      };
    } else if (p.action === 'memory') {
      const m = chat.memory.find((m) => m.id === b.memoryId);
      if (!m) throw new HttpError(404, 'Memory not found');
      if (b.operation === 'delete')
        chat.memory = chat.memory.filter((x) => x.id !== m.id);
      else if (b.operation === 'confirm') {
        m.status = 'user_confirmed';
        m.updatedAt = new Date().toISOString();
      } else if (b.operation === 'reject') {
        m.status = 'contradicted';
        m.updatedAt = new Date().toISOString();
      } else throw new HttpError(400, 'Unknown memory operation');
    } else if (p.action === 'run') {
      run = await startRun(
        chat,
        b.useMemory !== false,
        typeof b.versionId === 'string' ? b.versionId : undefined,
      );
    } else {
      if (!run) throw new HttpError(404, 'Run not found');
      if (p.action === 'advance') {
        if (run.status !== 'running')
          throw new HttpError(409, 'Run is not active');
        try {
          const deps = await dependencies(owner, chat, run);
          const next = await advanceChatRun(chat, run, deps);
          chat = next.chat;
          run = next.run;
        } catch (e) {
          run.status = 'failed';
          run.error = e instanceof Error ? e.message : 'Run step failed';
        }
      } else if (p.action === 'reconcile') {
        if (
          !run.pending ||
          !['unknown', 'executing'].includes(run.pending.status) ||
          b.pendingId !== run.pending.id
        )
          throw new HttpError(409, 'No uncertain action to reconcile');
        if (
          typeof b.note !== 'string' ||
          b.note.trim().length < 10 ||
          b.note.length > 3000
        )
          throw new HttpError(
            400,
            'Describe the outcome you verified in the connected app (10–3,000 characters).',
          );
        chat.messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          createdAt: new Date().toISOString(),
          content: `External action reconciliation for ${run.pending.tool.slug}: ${b.note.trim()}`,
        });
        run.error =
          'External outcome reviewed by the user. This run remains stopped; a new run represents a new execution intent.';
        run.pending = null;
        run.status = 'blocked';
        run.phase = 'done';
      } else if (p.action === 'pause') {
        if (
          run.pending &&
          ['executing', 'unknown'].includes(run.pending.status)
        )
          throw new HttpError(
            409,
            'Reconcile the dispatched action before stopping this run.',
          );
        if (!['running', 'awaiting_approval', 'paused'].includes(run.status))
          throw new HttpError(409, 'Run is not active');
        if (b.stop === true) {
          run.status = 'blocked';
          run.phase = 'done';
          run.pending = null;
          run.error = 'Stopped by the user.';
        } else run.status = 'paused';
      } else if (p.action === 'resume') {
        if (run.status !== 'paused')
          throw new HttpError(409, 'Only paused runs can resume');
        run.status = run.pending ? 'awaiting_approval' : 'running';
      } else if (p.action === 'approve') {
        if (
          run.status !== 'awaiting_approval' ||
          run.pending?.status !== 'awaiting_approval' ||
          b.pendingId !== run.pending.id
        )
          throw new HttpError(409, 'The reviewed action changed.');
        run.pending.status = 'executing';
        await saveChat(chat, owner, token, run, true);
        const deps = await dependencies(owner, chat, run);
        await executePending(chat, run, deps);
      } else if (p.action === 'reject') {
        if (
          run.status !== 'awaiting_approval' ||
          run.pending?.status !== 'awaiting_approval'
        )
          throw new HttpError(409, 'No undispatched action is awaiting review');
        run.status = 'blocked';
        run.phase = 'done';
        run.pending = null;
        run.error = 'External action declined by the user.';
      }
    }
    chat.versions = chat.versions.slice(-30);
    chat.messages = chat.messages.slice(-80);
    await saveChat(chat, owner, token, run);
    return json(await snapshot(chat, owner));
  } catch (e) {
    if (token && owner && id)
      await releaseChat(id, owner, token).catch(() => {});
    const error =
      e instanceof HttpError
        ? e
        : new HttpError(
            502,
            e instanceof Error ? e.message : 'Operation failed',
          );
    return failure(error);
  }
}
