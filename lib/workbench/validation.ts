import type {
  Attempt,
  Chat,
  Criterion,
  Evaluation,
  Memory,
  Workflow,
} from './types.ts';
import { digest } from '../engine/runtime.ts';
import { needsZohoDraftDelivery, verifiedZohoDrafts } from './zoho-tools.ts';
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function validateWorkflow(input: unknown): Workflow {
  if (!input || typeof input !== 'object')
    throw new Error('Workflow must be an object');
  const w = input as Workflow;
  if (
    !text(w.title, 120) ||
    !text(w.explanation, 3000) ||
    !Array.isArray(w.nodes) ||
    w.nodes.length < 1 ||
    w.nodes.length > 8
  )
    throw new Error('Workflow requires a title and 1–8 agents');
  const ids = new Set<string>();
  for (const n of w.nodes) {
    if (
      !n ||
      !text(n.id, 40) ||
      !/^[a-z][a-z0-9_]*$/.test(n.id) ||
      ids.has(n.id) ||
      !text(n.name, 100) ||
      !text(n.role, 300) ||
      !text(n.instruction, 4000) ||
      !Array.isArray(n.dependsOn) ||
      !Array.isArray(n.toolkits) ||
      n.toolkits.length > 5 ||
      !n.toolkits.every(
        (t) => typeof t === 'string' && /^[a-z0-9_]{1,60}$/.test(t),
      )
    )
      throw new Error('Invalid agent definition');
    ids.add(n.id);
  }
  for (const n of w.nodes)
    if (
      n.dependsOn.some((id) => !ids.has(id) || id === n.id) ||
      new Set(n.dependsOn).size !== n.dependsOn.length
    )
      throw new Error('Agent dependencies must reference other unique agents');
  const visited = new Set<string>();
  for (let i = 0; i < w.nodes.length; i++)
    for (const n of w.nodes)
      if (n.dependsOn.every((id) => visited.has(id))) visited.add(n.id);
  if (visited.size !== w.nodes.length)
    throw new Error('Workflow contains a dependency cycle');
  const children = new Set(w.nodes.flatMap((n) => n.dependsOn));
  if (w.nodes.filter((n) => !children.has(n.id)).length !== 1)
    throw new Error(
      'Workflow must have one final delivery agent that joins all branches',
    );
  if (
    !Array.isArray(w.criteria) ||
    w.criteria.length < 2 ||
    w.criteria.length > 6
  )
    throw new Error('Provide 2–6 evaluation criteria');
  const criteria = new Set<string>();
  for (const c of w.criteria) {
    if (
      !c ||
      !text(c.id, 50) ||
      criteria.has(c.id) ||
      !text(c.name, 100) ||
      !text(c.description, 1500) ||
      typeof c.weight !== 'number' ||
      !Number.isFinite(c.weight) ||
      c.weight <= 0 ||
      c.weight > 10 ||
      typeof c.required !== 'boolean'
    )
      throw new Error('Invalid evaluation rubric');
    if (c.assertion) {
      const a = c.assertion;
      if (
        !['rubric', 'word_count', 'contains', 'excludes'].includes(a.kind) ||
        !Number.isInteger(a.min) ||
        !Number.isInteger(a.max) ||
        a.min < 0 ||
        a.max < 0 ||
        a.max > 20000 ||
        !Array.isArray(a.terms) ||
        a.terms.length > 30 ||
        !a.terms.every(
          (t) => typeof t === 'string' && t.length > 0 && t.length <= 200,
        ) ||
        (a.kind === 'word_count' && a.max < a.min)
      )
        throw new Error('Invalid deterministic assertion');
    }
    criteria.add(c.id);
  }
  return structuredClone(w);
}
export function normalizeEvaluation(
  raw: Evaluation,
  rubric: Criterion[],
  attempt: Attempt,
  target: number,
): Evaluation {
  if (!raw || !Array.isArray(raw.checks) || typeof raw.summary !== 'string')
    throw new Error('Evaluator returned an invalid assessment');
  const evidence = new Set(
    attempt.traces.filter((t) => !t.error).map((t) => t.id),
  );
  const parents = new Set(attempt.workflow.nodes.flatMap((n) => n.dependsOn));
  const finalNode = attempt.workflow.nodes.find((n) => !parents.has(n.id));
  const final = attempt.states.find((s) => s.nodeId === finalNode?.id);
  const finalRefs = attempt.traces
    .filter((t) => t.nodeId === finalNode?.id && t.kind === 'model' && !t.error)
    .map((t) => t.id);
  const checks = rubric.map((c) => {
    if (c.assertion && c.assertion.kind !== 'rubric') {
      const assertion = c.assertion,
        text = (final?.output ?? '')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/[#*_`>]/g, '')
          .trim();
      const words = text ? text.split(/\s+/u).length : 0;
      const passed =
        assertion.kind === 'word_count'
          ? words >= assertion.min && words <= assertion.max
          : assertion.kind === 'contains'
            ? assertion.terms.every((t) =>
                text.toLowerCase().includes(t.toLowerCase()),
              )
            : assertion.terms.every(
                (t) => !text.toLowerCase().includes(t.toLowerCase()),
              );
      const verified = final?.status === 'done' && finalRefs.length > 0;
      return {
        criterionId: c.id,
        score: verified && passed ? 1 : 0,
        rationale:
          assertion.kind === 'word_count'
            ? `Deterministic check: ${words} whitespace-separated words in the final output (including headings); expected ${assertion.min}–${assertion.max}.`
            : `Deterministic ${assertion.kind} check ${passed ? 'passed' : 'failed'} for the specified literal terms.`,
        evidenceIds: finalRefs,
        verified,
      };
    }
    const match = raw.checks.find((k) => k.criterionId === c.id);
    const refs = match?.evidenceIds?.filter((id) => evidence.has(id)) ?? [];
    const verified = Boolean(
      match &&
      typeof match.score === 'number' &&
      Number.isFinite(match.score) &&
      refs.length &&
      match.rationale?.trim(),
    );
    return {
      criterionId: c.id,
      score: verified ? Math.max(0, Math.min(1, match!.score)) : 0,
      rationale:
        match?.rationale?.slice(0, 2000) ?? 'No evaluator evidence supplied',
      evidenceIds: refs,
      verified,
    };
  });
  const missingToolEvidence = attempt.workflow.nodes.some(
    (n) =>
      n.toolkits.length > 0 &&
      !attempt.traces.some(
        (t) => t.nodeId === n.id && t.kind === 'tool' && !t.error,
      ),
  );
  const missingZohoDelivery = needsZohoDraftDelivery(attempt) && verifiedZohoDrafts(attempt).length === 0;
  const blocked =
    attempt.states.some((s) => s.status !== 'done') || missingToolEvidence || missingZohoDelivery;
  const score = blocked
    ? 0
    : checks.reduce(
        (sum, c) =>
          sum + c.score * rubric.find((r) => r.id === c.criterionId)!.weight,
        0,
      ) / rubric.reduce((sum, c) => sum + c.weight, 0);
  const requiredFailed = rubric.some(
    (c) =>
      c.required &&
      (checks.find((k) => k.criterionId === c.id)?.score ?? 0) < target,
  );
  return {
    score,
    verdict: blocked
      ? missingZohoDelivery || attempt.states.some(
          (s) =>
            s.blockReason === 'connection' ||
            s.blockReason === 'input' ||
            s.blockReason === 'budget',
        )
        ? 'blocked'
        : 'revise'
      : score >= target && !requiredFailed
        ? 'pass'
        : 'revise',
    checks,
    summary: missingZohoDelivery
      ? 'No verified draft invoices were created in Zoho Books. These results cover preparation or simulation only. Resolve customer/tax mappings and approve a live draft creation before claiming delivery.'
      : raw.summary.slice(0, 4000),
    issues: [
      ...(missingZohoDelivery ? ['Live Zoho delivery is unverified: 0 draft invoices with creation and read-back evidence. Read/list calls and simulated payloads do not satisfy invoice creation.'] : []),
      ...(missingToolEvidence
        ? ['An agent requiring app access has no successful tool evidence.']
        : []),
      ...(Array.isArray(raw.issues)
        ? raw.issues.filter((i) => typeof i === 'string').slice(0, 10)
        : []),
    ],
    memoryVerdicts: (raw.memoryVerdicts ?? [])
      .filter(
        (m) =>
          attempt.memoryIds.includes(m.id) &&
          ['supported', 'contradicted', 'unassessed'].includes(m.verdict),
      )
      .map((m) => ({
        ...m,
        evidenceIds: (m.evidenceIds ?? []).filter((id) => evidence.has(id)),
      })),
  };
}
export function retrieveMemory(chat: Chat, query: string, limit = 8): Memory[] {
  const words = new Set(query.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
  return chat.memory
    .filter((m) => m.status !== 'contradicted')
    .map((m) => {
      const overlap = (
        m.content.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []
      ).reduce((sum, w) => sum + (words.has(w) ? 1 : 0), 0);
      return {
        memory: m,
        score:
          overlap > 0
            ? overlap +
              (m.status === 'supported' || m.status === 'user_confirmed'
                ? 3
                : 0)
            : 0,
      };
    })
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memory.updatedAt.localeCompare(a.memory.updatedAt),
    )
    .slice(0, limit)
    .map((m) => m.memory);
}
export async function curateMemory(
  chat: Chat,
  runId: string,
  attempt: Attempt,
  proposals: Partial<Memory>[],
) {
  const evidence = new Set(attempt.traces.map((t) => t.id));
  const now = new Date().toISOString();
  for (const p of proposals.slice(0, 5)) {
    if (
      !text(p.content, 1200) ||
      !['context', 'tool_rule', 'preference', 'strategy', 'failure'].includes(
        p.kind ?? '',
      )
    )
      continue;
    const refs = (p.evidence ?? []).filter((id) => evidence.has(id));
    if (!refs.length) continue;
    const content = p.content!.trim();
    const key = await digest(content.toLowerCase().replace(/\s+/g, ' '));
    if (chat.memory.some((m) => m.id === key)) continue;
    chat.memory.push({
      id: key,
      kind: p.kind!,
      content,
      evidence: refs,
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      sourceRun: runId,
      supportedRuns: [],
      usedCount: 0,
    });
  }
  for (const v of attempt.evaluation?.memoryVerdicts ?? []) {
    const m = chat.memory.find((m) => m.id === v.id);
    if (
      !m ||
      !v.evidenceIds.length ||
      m.sourceRun === runId ||
      m.status === 'user_confirmed'
    )
      continue;
    if (v.verdict === 'contradicted') m.status = 'contradicted';
    else if (v.verdict === 'supported' && !m.supportedRuns.includes(runId)) {
      m.supportedRuns.push(runId);
      m.status = 'supported';
    }
    m.updatedAt = now;
  }
  // Bound context and persistence growth; user-confirmed entries are retained preferentially.
  if (chat.memory.length > 60)
    chat.memory = chat.memory
      .sort(
        (a, b) =>
          Number(b.status === 'user_confirmed') -
            Number(a.status === 'user_confirmed') ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, 60);
}
