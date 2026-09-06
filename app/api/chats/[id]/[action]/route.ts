import {
  runRecoveryChecks,
  recoveryCheckMessage,
} from '@/lib/workbench/recovery-checks';
import { advanceResilient } from '@/lib/workbench/recovery';
import { retainMessages } from '@/lib/workbench/messages';
import { validateAppSelection } from '@/lib/workbench/apps';
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
  announceTest,
  design,
  executePending,
  startRun,
} from '@/lib/workbench/engine';
import {
  applyArmResult,
  experimentBudgetExceeded,
  MAX_PAIRS,
  nextArm,
  planExperiment,
  startArm,
} from '@/lib/workbench/experiment';
import { validateWorkflow, retrieveMemory } from '@/lib/workbench/validation';
import { digest } from '@/lib/engine/runtime';
import type { Chat, Run } from '@/lib/workbench/types';
import { listKnowledge } from '@/lib/server/tool-knowledge-store';
/** Starts the next pending arm on the frozen graph, input, and memory snapshot. */
async function startExperimentArm(chat: Chat) {
  const experiment = chat.experiment!;
  const arm = nextArm(experiment)!;
  const run = await startRun(chat, arm.useMemory, experiment.versionId, {
    mode: 'test',
    input: experiment.input,
    experimentId: experiment.id,
    arm: arm.index,
    memoryPool: experiment.memorySnapshot,
  });
  // Arms are bounded harder than a normal test: this spends real model budget.
  run.maxIterations = Math.min(run.maxIterations, 2);
  run.maxToolCalls = Math.min(run.maxToolCalls, 8);
  chat.experiment = startArm(experiment, arm, run.id);
  return run;
}
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
      'recovery-checks',
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
      'experiment',
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
    if (p.action === 'recovery-checks') {
      const report = await runRecoveryChecks();
      chat.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        createdAt: report.at,
        content: recoveryCheckMessage(report),
      });
    } else if (p.action === 'message') {
      if (
        typeof b.message !== 'string' ||
        !b.message.trim() ||
        b.message.length > 12000
      )
        throw new HttpError(400, 'Message must be 1–12,000 characters.');
      if (b.selectedApps !== undefined)
        try {
          chat.selectedApps = validateAppSelection(b.selectedApps);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      chat = await design(
        chat,
        b.message,
        await dependencies(owner, chat),
        chat.selectedApps ?? [],
      );
      if (b.autoTest === true) {
        run = await startRun(chat, true, undefined, {
          mode: 'test',
          generateInput: true,
        });
        announceTest(chat, run);
      }
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
      if (b.mode !== undefined && !['test', 'manual'].includes(b.mode))
        throw new HttpError(400, 'Choose test or manual execution.');
      if (
        b.mode === 'manual' &&
        (typeof b.input !== 'string' ||
          !b.input.trim() ||
          b.input.length > 12000)
      )
        throw new HttpError(400, 'Provide 1–12,000 characters of run input.');
      run = await startRun(
        chat,
        b.useMemory !== false,
        typeof b.versionId === 'string' ? b.versionId : undefined,
        {
          mode: b.mode === 'manual' ? 'manual' : 'test',
          input: b.mode === 'manual' ? b.input : undefined,
          generateInput: b.mode !== 'manual',
        },
      );
      if (run.mode !== 'manual') announceTest(chat, run);
    } else if (p.action === 'experiment') {
      if (b.operation === 'cancel') {
        if (chat.experiment?.status !== 'running')
          throw new HttpError(409, 'No experiment is running.');
        chat.experiment.status = 'cancelled';
        chat.experiment.error = 'Cancelled by the user.';
        // Stop the arm in flight too, or it would keep advancing alone.
        if (active?.experimentId === chat.experiment.id) {
          run = active;
          run.status = 'blocked';
          run.phase = 'done';
          run.pending = null;
          run.error = 'Experiment cancelled by the user.';
        }
      } else if (b.operation === 'start') {
        if (active)
          throw new HttpError(
            409,
            'Finish or stop the current run before starting an experiment.',
          );
        if (chat.experiment?.status === 'running')
          throw new HttpError(409, 'An experiment is already running.');
        if (
          typeof b.input !== 'string' ||
          !b.input.trim() ||
          b.input.length > 12000
        )
          throw new HttpError(
            400,
            'Provide 1–12,000 characters of experiment input.',
          );
        if (!Number.isInteger(b.pairs) || b.pairs < 1 || b.pairs > MAX_PAIRS)
          throw new HttpError(400, `Choose between 1 and ${MAX_PAIRS} pairs.`);
        const version = chat.versions.at(-1);
        if (!version) throw new HttpError(409, 'Design a workflow first.');
        // With no memory to withhold, both arms are the same run and the
        // comparison would measure model variance rather than memory.
        if (!retrieveMemory(chat, chat.messages.filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join(' ')).length)
          throw new HttpError(
            409,
            'No relevant task memory matches this workflow, so both arms would be identical. Test the workflow first.',
          );
        chat.experiment = await planExperiment(
          chat,
          b.input.trim(),
          b.pairs,
          version.id,
          new Date().toISOString(),
        );
        chat.experiment.toolKnowledgeSnapshot = await listKnowledge(
          owner, version.workflow.nodes.flatMap((n) => n.toolkits),
        );
        run = await startExperimentArm(chat);
      } else throw new HttpError(400, 'Unknown experiment operation.');
    } else {
      if (!run) throw new HttpError(404, 'Run not found');
      if (p.action === 'advance') {
        if (run.status !== 'running')
          throw new HttpError(409, 'Run is not active');
        try {
          const deps = await dependencies(owner, chat, run);
          const next = await advanceResilient(chat, run, deps);
          chat = next.chat;
          run = next.run;
        } catch (e) {
          run.status = 'failed';
          run.error = e instanceof Error ? e.message : 'Run step failed';
        }
        // Experiments run read-only workflows. An arm that asks for an external
        // write is not a measurement, so decline it and end the experiment
        // rather than leaving the chat waiting on a review nobody expected.
        if (
          chat.experiment?.status === 'running' &&
          run.experimentId === chat.experiment.id &&
          run.status === 'awaiting_approval'
        ) {
          chat.experiment = applyArmResult(chat.experiment, run);
          run.status = 'blocked';
          run.phase = 'done';
          run.pending = null;
          run.error =
            'Experiments run read-only workflows only. The requested external write was declined.';
        }
        // An arm that just finished hands off to the next one. Saving under a
        // kept lease mirrors the approve path, so both writes stay guarded.
        if (
          chat.experiment?.status === 'running' &&
          run.experimentId === chat.experiment.id &&
          !['running', 'paused', 'awaiting_approval'].includes(run.status)
        ) {
          chat.experiment = applyArmResult(chat.experiment, run);
          const stop = experimentBudgetExceeded(chat.experiment);
          const following =
            chat.experiment.status === 'running' && !stop
              ? nextArm(chat.experiment)
              : null;
          if (stop && chat.experiment.status === 'running') {
            chat.experiment.status = 'failed';
            chat.experiment.error = stop;
          }
          if (following) {
            await saveChat(chat, owner, token, run, true);
            run = await startExperimentArm(chat);
          }
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
    chat.messages = retainMessages(chat.messages);
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
