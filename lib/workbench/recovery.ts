import { advanceChatRun } from './engine.ts';
import { digest } from '../engine/runtime.ts';
import {
  emptyUsage,
  type Chat,
  type Dependencies,
  type Run,
  type Observation,
} from './types.ts';
export type FailureClass =
  | 'transient'
  | 'authorization'
  | 'missing_input'
  | 'schema'
  | 'unknown';
export function classifyFailure(error: unknown): FailureClass {
  const message = error instanceof Error ? error.message : String(error);
  const status = /(?:Composio HTTP|HTTP status) (\d{3})\b/.exec(message)?.[1];
  if (status === '401' || status === '403') return 'authorization';
  if (status === '404') return 'missing_input';
  if (
    ['408', '429', '500', '502', '503', '504'].includes(status ?? '') ||
    (error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name))
  )
    return 'transient';
  if (
    /Tool arguments (?:failed the discovered JSON schema|must be a valid bounded JSON)/.test(
      message,
    )
  )
    return 'schema';
  return 'unknown';
}
export type RecoveryEvent = {
  category: FailureClass | 'stagnation';
  action: 'retry' | 'recovered' | 'stop';
  detail: string;
  countsToolCall?: boolean;
};
export async function recoverRead<T>(
  call: () => Promise<T>,
  safeRead: boolean,
  emit: (event: RecoveryEvent) => void,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  maxRetries = 2,
) {
  const started = performance.now();
  for (let retry = 0; ; retry++) {
    try {
      const value = await call();
      if (retry)
        emit({
          category: 'transient',
          action: 'recovered',
          detail: `The read succeeded after ${retry} retries.`,
        });
      return value;
    } catch (error) {
      const category = classifyFailure(error);
      if (
        !safeRead ||
        category !== 'transient' ||
        retry >= maxRetries ||
        performance.now() - started >= 45000
      )
        throw error;
      emit({
        category,
        action: 'retry',
        detail: `Retry ${retry + 1}/${maxRetries} for a transient read failure. No agent regeneration is needed.`,
      });
      await wait(250 * 2 ** retry + Math.floor(Math.random() * 100));
    }
  }
}
export async function fingerprint(t: Observation): Promise<string | null> {
  try {
    if (t.kind === 'tool')
      return digest({ slug: t.name, args: JSON.parse(t.input) });
    if (t.kind === 'model' && t.error) {
      const action = JSON.parse(t.output);
      if (action.action === 'tool')
        return digest({
          slug: action.toolSlug,
          args: JSON.parse(action.argumentsJson),
        });
    }
  } catch {
    /* A clipped or malformed payload is insufficient evidence of equality. */
  }
  return null;
}
export async function advanceResilient(
  chat: Chat,
  run: Run,
  deps: Dependencies,
  wait?: (ms: number) => Promise<void>,
) {
  const events: RecoveryEvent[] = [];
  const emit = (e: RecoveryEvent) => events.push(e);
  const tools = deps.tools;
  const wrapped: Dependencies = {
    ...deps,
    tools: tools
      ? {
          search: (query, allowed) =>
            recoverRead(() => tools.search(query, allowed), true, emit, wait),
          execute: async (slug, args) => {
            const tool = run.attempts
              .at(-1)
              ?.states.flatMap((s) => s.tools)
              .find((t) => t.slug === slug);
            // Approval and receipt handling remain in the underlying provider. A missing
            // schema cannot grant retry permission, and mutations are never retried.
            const safe = tool?.readOnly === true;
            const key = await digest({ slug, args });
            if (safe)
              for (const trace of run.attempts.flatMap((a) => a.traces)) {
                if (
                  trace.kind === 'tool' &&
                  trace.error &&
                  (await fingerprint(trace)) === key
                ) {
                  emit({
                    category: 'stagnation',
                    action: 'stop',
                    detail:
                      'The same read already failed with these arguments. Another identical request was prevented; change the input or reconnect the app.',
                  });
                  throw new Error(
                    'Recovery stopped an identical failed tool request. Change the arguments or resolve the underlying connection.',
                  );
                }
              }
            const traces = run.attempts.flatMap((a) => a.traces);
            const used = traces.filter(
              (t) =>
                t.kind === 'tool' ||
                t.name === 'Recovery: additional tool read',
            ).length;
            if (used >= run.maxToolCalls) {
              emit({
                category: 'stagnation',
                action: 'stop',
                detail:
                  'The tool-call budget is exhausted, including recovery retries.',
              });
              throw new Error('Run tool-call budget exhausted');
            }
            return recoverRead(
              () => tools.execute(slug, args),
              safe,
              (e) => emit({ ...e, countsToolCall: e.action === 'retry' }),
              wait,
              Math.min(2, run.maxToolCalls - used - 1),
            );
          },
        }
      : null,
  };
  const result = await advanceChatRun(chat, run, wrapped);
  const current = result.run.attempts.at(-1)!;
  const oldIds = new Set(
    run.attempts.flatMap((a) => a.traces).map((t) => t.id),
  );
  const fresh = current.traces.filter((t) => !oldIds.has(t.id) && t.error);
  for (const trace of fresh) {
    const category = classifyFailure(trace.error);
    let reason = '';
    if (category === 'authorization')
      reason =
        'The app rejected access. Reconnect or change permissions before running again; prompt repairs cannot grant access.';
    if (category === 'missing_input')
      reason =
        'The requested app resource was not found. Check the source ID or URL before running again.';
    if (category === 'transient')
      reason =
        'The transient failure exhausted its read retry budget. Try again after the service recovers.';
    if (category === 'schema') {
      const errors = current.traces.filter(
        (t) =>
          t.nodeId === trace.nodeId &&
          classifyFailure(t.error ?? '') === 'schema',
      );
      if (errors.length >= 2) {
        const state = current.states.find((s) => s.nodeId === trace.nodeId);
        if (state) {
          state.status = 'blocked';
          state.error =
            'Two argument-validation failures exhausted the local repair budget.';
        }
        result.run.phase = result.run.mode === 'manual' ? 'done' : 'evaluate';
        if (result.run.mode === 'manual') result.run.status = 'blocked';
        emit({
          category,
          action: 'stop',
          detail:
            'Two schema failures exhausted the local parameter repair budget. The test will evaluate the failure before considering a graph repair.',
        });
      }
    }
    if (reason) emit({ category, action: 'stop', detail: reason });
  }
  // Catch repeated invalid model arguments even when the schema firewall prevented dispatch.
  const failures = current.traces.filter((t) => t.error);
  if (failures.length >= 2) {
    const last = failures.at(-1)!,
      previous = failures.at(-2)!;
    if (
      fresh.some((t) => t.id === last.id) &&
      last.nodeId === previous.nodeId
    ) {
      const key = await fingerprint(last);
      if (
        key &&
        key === (await fingerprint(previous)) &&
        !events.some((e) => e.category === 'stagnation')
      )
        emit({
          category: 'stagnation',
          action: 'stop',
          detail:
            'Two failures used identical tool arguments. The loop stopped because its proposed actions made no progress.',
        });
    }
  }
  const terminal = events.find(
    (e) => e.action === 'stop' && e.category !== 'schema',
  );
  if (terminal && !result.run.pending) {
    result.run.status = 'blocked';
    result.run.phase = 'done';
    result.run.error = terminal.detail;
    current.finishedAt = new Date().toISOString();
    for (const state of current.states)
      if (state.status !== 'done') {
        state.status = 'blocked';
        state.error ||= terminal.detail;
      }
  }
  for (const event of events) {
    const id = crypto.randomUUID(),
      at = new Date().toISOString();
    current.traces.push({
      id,
      nodeId: 'recovery',
      kind: 'reflection',
      name: event.countsToolCall
        ? 'Recovery: additional tool read'
        : `Recovery: ${event.category} · ${event.action}`,
      at,
      durationMs: 0,
      input: 'Deterministic runtime recovery policy',
      output: event.detail,
      error: null,
      usage: emptyUsage(),
      langsmith: 'disabled',
    });
    if (result.run.mode !== 'manual')
      result.chat.messages.push({
        id,
        role: 'assistant',
        runId: run.id,
        attemptId: current.id,
        createdAt: at,
        content: `**Recovery · ${event.category}**\n\n${event.detail}`,
      });
  }
  return result;
}
