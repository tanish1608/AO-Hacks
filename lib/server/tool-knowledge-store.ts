import {
  knowledgeKey,
  mergeKnowledge,
  newKnowledge,
} from '../workbench/tool-knowledge';
import type { Knowledge, ToolKnowledgeRecord } from '../workbench/types';
import { database } from './store';
type Row = {
  id: string;
  toolkit: string;
  slug: string;
  kind: string;
  claim: string;
  detail: string;
  status: string;
  observations: number;
  successes: number;
  failures: number;
  applied_runs: number;
  first_run: string;
  last_run: string;
  confirmed_run: string | null;
  evidence: string;
  created_at: string;
  updated_at: string;
};
const parse = (row: Row): ToolKnowledgeRecord => ({
  id: row.id,
  toolkit: row.toolkit,
  slug: row.slug,
  kind: row.kind as ToolKnowledgeRecord['kind'],
  claim: row.claim,
  detail: JSON.parse(row.detail),
  status: row.status as ToolKnowledgeRecord['status'],
  observations: row.observations,
  successes: row.successes,
  failures: row.failures,
  appliedRuns: row.applied_runs,
  firstRun: row.first_run,
  lastRun: row.last_run,
  confirmedRun: row.confirmed_run,
  evidence: JSON.parse(row.evidence),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const COLUMNS =
  'id,toolkit,slug,kind,claim,detail,status,observations,successes,failures,applied_runs,first_run,last_run,confirmed_run,evidence,created_at,updated_at';
async function read(
  owner: string,
  toolkits: string[],
  limit = 24,
): Promise<ToolKnowledgeRecord[]> {
  const kits = [...new Set(toolkits.map((t) => t.toLowerCase()))].slice(0, 8);
  if (!kits.length) return [];
  const rows = await database()
    .prepare(
      `SELECT ${COLUMNS} FROM tool_knowledge WHERE owner_id=? AND status!='retired' AND toolkit IN (${kits
        .map(() => '?')
        .join(',')}) ORDER BY status='confirmed' DESC,observations DESC,updated_at DESC LIMIT ?`,
    )
    .bind(owner, ...kits, limit)
    .all<Row>();
  return rows.results.map(parse);
}
/**
 * Owner-scoped tool knowledge. Writes are content-addressed idempotent upserts
 * of advisory data, so they run outside the chat lease: coupling them to the
 * chat revision would let a knowledge write fail an otherwise good run step.
 */
export function knowledgeStore(owner: string): Knowledge {
  return {
    async lookup(toolkits, slugs) {
      const records = await read(owner, toolkits);
      return slugs
        ? records.filter((r) => !r.slug || slugs.includes(r.slug))
        : records;
    },
    async record(drafts) {
      for (const draft of drafts.slice(0, 20)) {
        const id = await knowledgeKey(owner, draft);
        const existing = await database()
          .prepare(
            `SELECT ${COLUMNS} FROM tool_knowledge WHERE id=? AND owner_id=?`,
          )
          .bind(id, owner)
          .first<Row>();
        const at = new Date().toISOString();
        const next = existing
          ? mergeKnowledge(parse(existing), draft, at)
          : newKnowledge(id, draft, at);
        await database()
          .prepare(
            `INSERT INTO tool_knowledge(id,owner_id,toolkit,slug,kind,claim,detail,status,observations,successes,failures,applied_runs,first_run,last_run,confirmed_run,evidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET claim=excluded.claim,detail=excluded.detail,status=excluded.status,observations=excluded.observations,successes=excluded.successes,failures=excluded.failures,last_run=excluded.last_run,confirmed_run=excluded.confirmed_run,evidence=excluded.evidence,updated_at=excluded.updated_at`,
          )
          .bind(
            next.id,
            owner,
            next.toolkit,
            next.slug,
            next.kind,
            next.claim,
            JSON.stringify(next.detail),
            next.status,
            next.observations,
            next.successes,
            next.failures,
            next.appliedRuns,
            next.firstRun,
            next.lastRun,
            next.confirmedRun,
            JSON.stringify(next.evidence),
            next.createdAt,
            next.updatedAt,
          )
          .run();
      }
    },
  };
}
/** An ablation arm reads what earlier runs learned but must not add to it. */
export function readOnlyKnowledge(owner: string): Knowledge {
  const base = knowledgeStore(owner);
  return {
    lookup: (toolkits, slugs) => base.lookup(toolkits, slugs),
    record: async () => {},
  };
}
/** Counts how often a rule was actually supplied to a run, for the learning view. */
export async function markKnowledgeApplied(owner: string, ids: string[]) {
  if (!ids.length) return;
  await database()
    .prepare(
      `UPDATE tool_knowledge SET applied_runs=applied_runs+1 WHERE owner_id=? AND id IN (${ids
        .map(() => '?')
        .join(',')})`,
    )
    .bind(owner, ...ids.slice(0, 24))
    .run();
}
export async function listKnowledge(owner: string, toolkits: string[]) {
  return read(owner, toolkits, 40);
}
