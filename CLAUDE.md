# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Agent Foundry** — a hackathon entry for *Track 1: Automated Agent Engineering*. It is a
conversational workspace where a user describes a task in chat, the system designs a
multi-agent DAG to do it, runs it against real third-party apps through Composio, evaluates
the output against a frozen rubric, reflects on the failure evidence, writes scoped memory,
repairs the graph, and retries — bounded by an iteration/token/tool budget.

Two surfaces:
- `/` — the **primary product**: chat + React Flow agent canvas (`components/chat-workspace.tsx`).
- `/lab` — an older synthetic deterministic experiment harness (`lib/engine/*`,
  `components/foundry-console.tsx`). Kept for the benchmark script; not the product.

Default model is **Gemini 3.8 Flash** (`FOUNDRY_MODEL`). All third-party tool access is
routed through **Composio v3 tool_router**. Orchestration steps run through **LangGraph**;
observability optionally forwards to **LangSmith**.

## Stack

- **vinext** (Next.js-compatible App Router on Vite) + React 19 RSC, deployed as a
  **Cloudflare Worker** (`wrangler`, Miniflare locally).
- **D1** (SQLite) via raw `D1Database.prepare` in `lib/server/*`; Drizzle is used only to
  declare the schema (`db/schema.ts`) and generate migrations into `drizzle/`.
- Tailwind v4, shadcn primitives in `components/ui/**` (generated — do not hand-edit;
  they are lint-excluded), `@xyflow/react` for the canvas.
- Auth is header-based ChatGPT/Sites SSO (`app/chatgpt-auth.ts`); every row is owner-scoped.

## Commands

```sh
npm run dev -- --hostname 127.0.0.1     # http://127.0.0.1:3000
npm run typecheck                       # tsc --noEmit
npm run lint                            # oxlint (type-aware)
npm test                                # node --test on tests/*.test.ts
npm run build                           # then: npm start (wrangler dev on dist/)
npm run db:generate                     # drizzle-kit generate after editing db/schema.ts
npm exec wrangler -- d1 migrations apply DB --local --config wrangler.local.json
npm run benchmark                       # synthetic /lab harness
npm run agent:run -- "task"             # tool-free workflow from the terminal
python3 scripts/smoke-workbench.py      # live Gemini, no external writes
node --experimental-strip-types scripts/check-composio.ts
```

Secrets live in `.dev.vars` (gitignored), shape defined in `.env.example`:
`GEMINI_API_KEY`, `COMPOSIO_API_KEY`, optional `LANGSMITH_*` and price overrides.

## Architecture: the learning loop

`lib/workbench/engine.ts` is the core. Everything else orbits it.

A **Chat** (`lib/workbench/types.ts`) is the unit of isolation: it owns the goal, a stack of
`WorkflowVersion`s, its own `Memory[]`, settings (`target`, `maxIterations`, `maxToolCalls`),
and a Composio `sessionId`. Memory never crosses chats.

A **Run** holds `attempts[]`. Each attempt snapshots the workflow, its digest, per-node
`AgentState`, `Observation` traces, and one `Evaluation`. `run.phase` drives a LangGraph
`StateGraph` whose every node returns to `END` — **one API call advances exactly one phase**,
so progress is durable in D1 between steps rather than held in a long-lived process:

```
prepare → execute (loop per ready node) → evaluate → reflect → repair → execute → …
```

- `design()` — LLM emits a validated DAG + 2–6 criteria. Rejects toolkits outside `selectedApps`.
- `prepareTest()` — generates one representative test input (`inputOrigin: 'generated'`).
- `execute()` — picks the next node whose deps are `done`; discovers real tool schemas via
  Composio `search` (never invents slugs); the node returns `finish | tool | blocked`.
- `assess()` — independent evaluator scores the **frozen** `run.rubric`.
- `reflect()` — proposes ≤4 evidence-cited memories and a repair instruction.
- `repair()` — rewrites the graph but `criteria` is forcibly restored from `run.rubric`.

### Invariants that must not be broken

These are the substance of the track submission. Preserve them in any refactor.

1. **The rubric is frozen per run.** `repair()` overwrites the model's criteria with
   `run.rubric`. Never let an optimizer edit its own scoring function.
2. **Deterministic assertions override the LLM judge.** In `normalizeEvaluation()`,
   `word_count | contains | excludes` criteria are computed in code; only `rubric`-kind
   criteria use the model's score.
3. **Every check needs evidence.** A check with no valid trace ID in `evidenceIds` scores 0
   (`verified: false`). Same for memory: `curateMemory()` drops proposals with no live trace ref.
4. **No tool evidence ⇒ no pass.** A node with `toolkits` and no successful `kind: 'tool'`
   trace forces the whole evaluation to score 0.
5. **Memory is a hypothesis until corroborated.** Status goes `proposed → supported`
   (verdict from a *later* run — `m.sourceRun === runId` is skipped) or `contradicted`.
   `user_confirmed` is sticky. Retrieval (`retrieveMemory`) skips contradicted entries.
6. **External writes require review.** Only `isReviewedRead()` tools auto-execute; everything
   else sets `run.pending` and `status: 'awaiting_approval'`. `lib/workbench/tool-policy.ts`
   is an explicit allowlist — a model claim or a name prefix never grants permission.
7. **Idempotency receipts.** `tool_receipts` is claimed before dispatch (keyed on
   owner+chat+run+slug+args). A failed write becomes `status: 'unknown'` and blocks the run
   until the user reconciles — never blind-replayed.
8. **Optimistic concurrency.** Every mutation takes a lease (`leaseChat`) and saves under
   `revision` + `lease_token`; the run insert is in the same D1 batch, guarded on the chat's
   new revision. Mismatches are 409, not overwrites.
9. **Cost is `null`, never `0`, when unknown.** `addUsage` propagates null. The Gemini
   introductory-price fallback in `lib/workbench/model.ts` expires 2027-01-01.
10. **Bounded everything.** 7 turns/node, `maxToolCalls`/run, 250k tokens/run, 8 nodes,
    60 memories, 30 versions, 80 messages (`retainMessages` pins the first + last 3 user turns).

### Honesty constraints in prose

The README and `docs/PRODUCT_DIRECTION.md` deliberately state that rubric score ≠ measured
accuracy and that **memory has not yet been shown to reduce attempts or cost**. Negative
results are retained on purpose. Do not upgrade these claims without new evidence in
`docs/*_EVIDENCE.json`.

## Layout

```
app/api/chats/[id]/[action]/route.ts   all chat mutations (message|run|advance|approve|…)
lib/workbench/engine.ts                the loop
lib/workbench/validation.ts            DAG validation, evaluation normalization, memory curation
lib/workbench/composio.ts              Composio v3 tool_router gateway
lib/workbench/model.ts                 Gemini structured-output client + usage/cost
lib/workbench/{types,schemas,apps,tool-policy,messages}.ts
lib/server/workbench-store.ts          D1 persistence, leases, snapshots
lib/server/workbench-provider.ts       Dependencies wiring: model + tools + LangSmith trace
lib/engine/*                           legacy /lab synthetic harness
components/chat-workspace.tsx          the whole product UI (large; edit surgically)
components/{workflow-canvas,run-conversation,test-results,app-picker}.tsx
tests/workbench.test.ts                loop regression tests with a stubbed Model/Tools
```

## Conventions

- TypeScript ESM with `.ts` extensions on relative imports (Node `--experimental-strip-types`
  runs the tests directly); `@/` alias for app-root imports in Next code.
- Dense, compact style — short helpers, ternary chains, minimal comments. Comments explain
  *why* a safety rule exists, not what the line does. Match it.
- `typescript/no-explicit-any` is an error. `oxfmt` for formatting.
- Prefer extending the existing single `[action]` route over adding new endpoints.
- After editing `db/schema.ts`, run `db:generate` and apply migrations locally.
- Never write secrets into client components; all provider keys stay in Worker env.

## Testing the loop

`tests/workbench.test.ts` injects a fake `Model` returning canned structured values and a
fake `Tools`, then asserts the full failure → reflection → repair → retest event sequence.
Add cases there rather than mocking HTTP.
