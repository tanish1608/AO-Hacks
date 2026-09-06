import { digest } from '../engine/runtime.ts';
import type {
  Attempt,
  DiscoveredTool,
  ToolKnowledgeDraft,
  ToolKnowledgeRecord,
  ToolOutcome,
} from './types.ts';
const SCHEMA_REJECTION = 'failed the discovered JSON schema';
/**
 * Provider error text can quote document contents, so it is never stored. Each
 * message is reduced to a bounded token describing the class of failure.
 */
export function classifyToolError(message: string | null): {
  signature: string | null;
  outcome: ToolOutcome;
} {
  if (!message) return { signature: null, outcome: 'ok' };
  const m = message.toLowerCase();
  if (m.includes(SCHEMA_REJECTION.toLowerCase())) {
    const required = /required property '([a-z0-9_]{1,40})'/i.exec(message);
    return {
      signature: required
        ? `schema:required:${required[1].toLowerCase()}`
        : 'schema:invalid',
      outcome: 'schema_rejected',
    };
  }
  if (/\b(401|403|unauthor|forbidden|no active connection|not connected|invalid.{0,12}token|expired)\b/.test(m))
    return { signature: 'auth:not_authorized', outcome: 'auth' };
  if (/\b(404|not found|does not exist|no such)\b/.test(m))
    return { signature: 'http:404', outcome: 'not_found' };
  if (/\b(429|rate limit|too many requests|quota)\b/.test(m))
    return { signature: 'http:429', outcome: 'rate_limited' };
  if (/\b(5\d\d|timeout|timed out|unavailable)\b/.test(m))
    return { signature: 'http:5xx', outcome: 'unknown' };
  return { signature: 'error:unclassified', outcome: 'unknown' };
}
const list = (keys: string[]) => keys.map((k) => `\`${k}\``).join(', ');
/** Claims are rendered from structure, so the model never authors what is stored. */
export function renderClaim(draft: ToolKnowledgeDraft): string {
  if (draft.claim) return draft.claim;
  const { slug, argKeys, rejectedKeys, requiredKeys } = draft;
  if (draft.kind === 'auth')
    return `${draft.toolkit} needs an authorized account before its tools can run.`;
  if (draft.outcome === 'ok')
    return argKeys.length
      ? `${slug} succeeded with ${list(argKeys)}.`
      : `${slug} succeeded with no arguments.`;
  if (draft.outcome === 'schema_rejected')
    return `${slug} rejected ${list(argKeys) || 'those arguments'}${
      requiredKeys.length ? `; its schema requires ${list(requiredKeys)}` : ''
    }${rejectedKeys.length ? `. Unknown here: ${list(rejectedKeys)}` : '.'}`;
  return `${slug} failed with ${draft.errorSignature ?? 'an unclassified error'}${
    argKeys.length ? ` when called with ${list(argKeys)}` : ''
  }.`;
}
/** The discriminating fact, so the same lesson from two chats collapses onto one row. */
function signature(draft: ToolKnowledgeDraft) {
  if (draft.claim) return draft.claim.toLowerCase();
  if (draft.kind === 'auth') return 'auth';
  return draft.outcome === 'ok'
    ? 'ok:' + [...draft.argKeys].sort().join(',')
    : `${draft.errorSignature ?? 'unknown'}:${[...draft.argKeys].sort().join(',')}`;
}
export function knowledgeKey(owner: string, draft: ToolKnowledgeDraft) {
  return digest({
    owner,
    toolkit: draft.toolkit,
    slug: draft.slug,
    kind: draft.kind,
    signature: signature(draft),
  });
}
const cap = (values: string[], n: number) => [...new Set(values)].slice(0, n);
export function newKnowledge(
  id: string,
  draft: ToolKnowledgeDraft,
  now: string,
): ToolKnowledgeRecord {
  return {
    id,
    toolkit: draft.toolkit,
    slug: draft.slug,
    kind: draft.kind,
    claim: renderClaim(draft),
    detail: {
      argKeys: cap(draft.argKeys, 24),
      rejectedKeys: cap(draft.rejectedKeys, 24),
      requiredKeys: cap(draft.requiredKeys, 24),
      errorSignature: draft.errorSignature,
      outcome: draft.outcome,
    },
    status: 'proposed',
    observations: 1,
    successes: draft.outcome === 'ok' ? 1 : 0,
    failures: draft.outcome === 'ok' ? 0 : 1,
    appliedRuns: 0,
    firstRun: draft.runId,
    lastRun: draft.runId,
    confirmedRun: null,
    evidence: cap(draft.evidence, 8),
    createdAt: now,
    updatedAt: now,
  };
}
/**
 * Mirrors the chat-memory rule: a lesson stays proposed until a *different run*
 * observes it again. A confirmed rule contradicted twice is retired rather than
 * silently kept.
 */
export function mergeKnowledge(
  existing: ToolKnowledgeRecord,
  draft: ToolKnowledgeDraft,
  now: string,
): ToolKnowledgeRecord {
  const next: ToolKnowledgeRecord = {
    ...existing,
    detail: { ...existing.detail },
    observations: existing.observations + 1,
    successes: existing.successes + (draft.outcome === 'ok' ? 1 : 0),
    failures: existing.failures + (draft.outcome === 'ok' ? 0 : 1),
    lastRun: draft.runId,
    evidence: cap([...existing.evidence, ...draft.evidence], 8),
    updatedAt: now,
  };
  if (draft.requiredKeys.length)
    next.detail.requiredKeys = cap(draft.requiredKeys, 24);
  if (
    next.status === 'proposed' &&
    next.observations >= 2 &&
    draft.runId !== existing.firstRun
  ) {
    next.status = 'confirmed';
    next.confirmedRun = draft.runId;
  }
  const contradicted =
    existing.detail.outcome === 'ok' ? next.failures : next.successes;
  if (next.status === 'confirmed' && contradicted >= 2) next.status = 'retired';
  return next;
}
/** Bounded prompt block. Only confirmed rules are injected; proposed ones stay advisory in the UI. */
export function formatKnowledgeForPrompt(
  records: ToolKnowledgeRecord[],
  limit = 12,
) {
  return records
    .filter((r) => r.status === 'confirmed')
    .slice(0, limit)
    .map((r) => ({
      toolkit: r.toolkit,
      slug: r.slug,
      claim: r.claim,
      observations: r.observations,
    }));
}
function argumentKeys(json: string) {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).slice(0, 24)
      : [];
  } catch {
    return [];
  }
}
function schemaKeys(tool: DiscoveredTool | undefined) {
  const required = (tool?.schema as { required?: unknown } | undefined)
    ?.required;
  return Array.isArray(required)
    ? required.filter((k): k is string => typeof k === 'string').slice(0, 24)
    : [];
}
function properties(tool: DiscoveredTool | undefined) {
  const props = (tool?.schema as { properties?: unknown } | undefined)
    ?.properties;
  return props && typeof props === 'object' && !Array.isArray(props)
    ? Object.keys(props as Record<string, unknown>)
    : [];
}
/**
 * Derives tool facts from what actually happened. Reads only trace structure,
 * so it cannot invent a rule the run did not demonstrate.
 */
export function extractToolKnowledge(
  attempt: Attempt,
  runId: string,
  /** Restricts extraction to traces produced by the current step, so repeated
   *  calls during one attempt cannot inflate a record's observation count. */
  onlyTraceIds?: string[],
): ToolKnowledgeDraft[] {
  const tools = attempt.states.flatMap((s) => s.tools);
  const find = (slug: string) => tools.find((t) => t.slug === slug);
  const drafts: ToolKnowledgeDraft[] = [];
  const scope = onlyTraceIds ? new Set(onlyTraceIds) : null;
  for (const t of attempt.traces) {
    if (scope && !scope.has(t.id)) continue;
    if (t.kind === 'tool') {
      const tool = find(t.name);
      if (!tool) continue;
      const argKeys = argumentKeys(t.input);
      const { signature: errorSignature, outcome } = classifyToolError(t.error);
      drafts.push({
        toolkit: tool.toolkit,
        slug: tool.slug,
        kind: t.error ? 'failure' : 'argument_shape',
        argKeys,
        rejectedKeys: [],
        requiredKeys: schemaKeys(tool),
        errorSignature,
        outcome,
        evidence: [t.id],
        runId,
      });
      continue;
    }
    // A rejected tool request is recorded on the model trace that proposed it.
    if (t.kind !== 'model' || !t.error?.includes(SCHEMA_REJECTION)) continue;
    let requested: { toolSlug?: unknown; argumentsJson?: unknown };
    try {
      requested = JSON.parse(t.output) as typeof requested;
    } catch {
      continue;
    }
    if (typeof requested.toolSlug !== 'string') continue;
    const tool = find(requested.toolSlug);
    if (!tool) continue;
    const argKeys =
      typeof requested.argumentsJson === 'string'
        ? argumentKeys(requested.argumentsJson)
        : [];
    const known = properties(tool);
    const rejection = classifyToolError(t.error);
    drafts.push({
      toolkit: tool.toolkit,
      slug: tool.slug,
      kind: 'failure',
      argKeys,
      rejectedKeys: known.length ? argKeys.filter((k) => !known.includes(k)) : [],
      requiredKeys: schemaKeys(tool),
      errorSignature: rejection.signature,
      outcome: rejection.outcome,
      evidence: [t.id],
      runId,
    });
  }
  for (const s of attempt.states)
    if (s.blockReason === 'connection' && (!scope || s.observations.some((id) => scope.has(id))))
      for (const toolkit of new Set(s.tools.map((t) => t.toolkit)))
        drafts.push({
          toolkit,
          slug: '',
          kind: 'auth',
          argKeys: [],
          rejectedKeys: [],
          requiredKeys: [],
          errorSignature: 'auth:not_authorized',
          outcome: 'auth',
          evidence: s.observations.slice(-1),
          runId,
        });
  return drafts.slice(0, 20);
}
