import { env } from 'cloudflare:workers';
import { Client } from 'langsmith';
import { geminiModel } from '../workbench/model';
import { ComposioGateway } from '../workbench/composio';
import type { Chat, Dependencies, Run } from '../workbench/types';
import { digest } from '../engine/runtime';
import { database } from './store';
import { HttpError } from './security';
import { knowledgeStore } from './tool-knowledge-store';
import { frozenKnowledge } from '../workbench/experiment';
import { zohoTools } from '../workbench/zoho-tools';
import { isReviewedRead } from '../workbench/tool-policy';
import {
  applyLiveness,
  liveToolkits,
  readSchemaCache,
  writeSchemaCache,
} from './tool-cache';
const config = () => env as unknown as Record<string, string | undefined>;
export function workbenchStatus() {
  const e = config();
  return {
    model: e.FOUNDRY_MODEL || 'gemini-3.8-flash',
    gemini: Boolean(e.GEMINI_API_KEY),
    composio: Boolean(e.COMPOSIO_API_KEY),
    langsmith: Boolean(e.LANGSMITH_API_KEY),
    pricing: Boolean(
      e.FOUNDRY_INPUT_PRICE_PER_MILLION && e.FOUNDRY_OUTPUT_PRICE_PER_MILLION,
    ),
  };
}
export function gateway() {
  const key = config().COMPOSIO_API_KEY;
  if (!key)
    throw new HttpError(
      503,
      'Set COMPOSIO_API_KEY in the server environment to connect apps.',
    );
  return new ComposioGateway(key);
}
export async function integrationSession(owner: string) {
  const row = await database()
    .prepare('SELECT session_id FROM integration_sessions WHERE owner_id=?')
    .bind(owner)
    .first<{ session_id: string }>();
  if (row) return row.session_id;
  const s = await gateway().session('foundry:' + owner);
  await database()
    .prepare(
      'INSERT INTO integration_sessions(owner_id,session_id,created_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO NOTHING',
    )
    .bind(owner, s.session_id, new Date().toISOString())
    .run();
  return (await database()
    .prepare('SELECT session_id FROM integration_sessions WHERE owner_id=?')
    .bind(owner)
    .first<{ session_id: string }>())!.session_id;
}
export async function dependencies(
  owner: string,
  chat: Chat,
  run?: Run,
): Promise<Dependencies> {
  const e = config();
  if (!e.GEMINI_API_KEY)
    throw new HttpError(
      503,
      'Set GEMINI_API_KEY in the server environment to generate and run agents.',
    );
  let tools: Dependencies['tools'] = null;
  if (e.COMPOSIO_API_KEY) {
    const g = gateway();
    if (!chat.sessionId)
      chat.sessionId = (await g.session('foundry:' + owner)).session_id;
    const session = chat.sessionId;
    tools = {
      search: async (query, allowed) => {
        // Schemas are stable enough to reuse; authorization is not, so a hit
        // still re-checks liveness and falls through when that is uncertain.
        const cached = run?.experimentId ? null : await readSchemaCache(owner, query, allowed).catch(
          () => null,
        );
        if (cached) {
          const live = await liveToolkits(g, session);
          if (live && cached.every((t) => live.has(t.toolkit.toLowerCase()))) {
            const current = applyLiveness(cached, live)
              .filter(t => !t.slug.startsWith('FOUNDRY_ZOHO_'))
              .map(t => ({ ...t, readOnly: t.readOnly || isReviewedRead(t.slug) }));
            if (allowed.includes('zoho_books')) current.push(...zohoTools(live.has('zoho_books')));
            return current;
          }
        }
        const fresh = await g.search(session, query, allowed);
        if (!run?.experimentId)
          await writeSchemaCache(owner, query, allowed, fresh).catch(() => {});
        return fresh.map((t) => ({ ...t, source: 'live' as const }));
      },
      execute: async (slug, args) => {
        const current = run?.attempts.at(-1);
        const tool = current?.states
          .flatMap((s) => s.tools)
          .find((t) => t.slug === slug);
        if (!tool)
          throw new Error(
            'Tool is outside the current discovered capabilities',
          );
        if (tool.readOnly) return g.execute(session, slug, args);
        if (!run?.pending || run.pending.tool.slug !== slug)
          throw new Error('External writes require a reviewed pending action');
        // Receipts span repair attempts in one run. A new user-started run is a new execution intent.
        const id = await digest({
          owner,
          chat: chat.id,
          run: run.id,
          slug,
          args,
        });
        const existing = await database()
          .prepare(
            'SELECT state,payload FROM tool_receipts WHERE id=? AND owner_id=?',
          )
          .bind(id, owner)
          .first<{ state: string; payload: string | null }>();
        if (existing?.state === 'done') return JSON.parse(existing.payload!);
        if (existing)
          throw new Error(
            'A previous dispatch has an unknown outcome; reconcile it in the connected app.',
          );
        const claimed = await database()
          .prepare(
            'INSERT INTO tool_receipts(id,owner_id,chat_id,run_id,state,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
          )
          .bind(id, owner, chat.id, run.id, 'started', new Date().toISOString())
          .run();
        if (!claimed.meta.changes)
          throw new Error('This action has already been dispatched.');
        const result = await g.execute(session, slug, args);
        const payload = JSON.stringify(result);
        if (payload.length > 100000)
          throw new Error(
            'External result exceeds checkpoint size; reconcile the completed action in the app.',
          );
        await database()
          .prepare(
            "UPDATE tool_receipts SET state='done',payload=? WHERE id=? AND owner_id=?",
          )
          .bind(payload, id, owner)
          .run();
        return result;
      },
    };
  }
  const client = e.LANGSMITH_API_KEY
    ? new Client({
        apiKey: e.LANGSMITH_API_KEY,
        autoBatchTracing: false,
        timeout_ms: 5000,
      })
    : null;
  return {
    // An ablation arm may read what earlier runs learned but must not add to it,
    // or the second arm would learn from the first and confound the comparison.
    knowledge: run?.experimentId
      ? frozenKnowledge(chat.experiment?.id === run.experimentId ? chat.experiment : undefined)
      : knowledgeStore(owner),
    model: geminiModel({
      key: e.GEMINI_API_KEY,
      model: e.FOUNDRY_MODEL || 'gemini-3.8-flash',
      inputPrice: e.FOUNDRY_INPUT_PRICE_PER_MILLION,
      outputPrice: e.FOUNDRY_OUTPUT_PRICE_PER_MILLION,
    }),
    tools,
    trace: async (t, runId) => {
      if (!client) return 'disabled';
      const content = e.LANGSMITH_TRACE_CONTENT === 'true';
      const start = Date.parse(t.at) - t.durationMs;
      try {
        await client.createRun({
          id: t.id,
          name: t.name,
          run_type: t.usage.model
            ? 'llm'
            : t.kind === 'tool'
              ? 'tool'
              : 'chain',
          start_time: start,
          end_time: Date.parse(t.at),
          project_name: e.LANGSMITH_PROJECT || 'agent-foundry',
          inputs: {
            messages: [
              {
                role: 'user',
                content: content ? t.input : '[content recording disabled]',
              },
            ],
          },
          outputs: {
            messages: [
              {
                role: 'assistant',
                content: content ? t.output : '[content recording disabled]',
              },
            ],
            usage_metadata: {
              input_tokens: t.usage.inputTokens,
              output_tokens: t.usage.outputTokens,
              total_tokens: t.usage.inputTokens + t.usage.outputTokens,
            },
          },
          error: t.error ?? undefined,
          extra: {
            metadata: {
              foundry_run_id: runId,
              ls_provider: 'google_genai',
              ls_model_name: t.usage.model,
              node_id: t.nodeId,
              kind: t.kind,
              cost_usd: t.usage.costUsd,
            },
          },
        });
        return 'sent';
      } catch {
        return 'failed';
      }
    },
  };
}
