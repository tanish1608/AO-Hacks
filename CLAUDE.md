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
and a Composio `sessionId`. Task memory never crosses chats.

**Tool knowledge is the one thing that does.** It is a separate, owner-scoped store
(`tool_knowledge`) holding only what runs observed about an app's tools — argument keys that
validated, keys a schema rejected, classified error tokens, auth quirks. This is what makes a
new task start informed rather than blind. The two stores are deliberately different things;
see invariant 11.

A **Run** holds `attempts[]`. Each attempt snapshots the workflow, its digest, per-node
`AgentState`, `Observation` traces, and one `Evaluation`. `run.phase` drives a LangGraph
`StateGraph` whose every node returns to `END` — **one API call advances exactly one phase**,
so progress is durable in D1 between steps rather than held in a long-lived process:

```
prepare → execute (loop per ready node) → evaluate → reflect → repair → execute → …
```

An **Experiment** (`chat.experiment`) is a sequential queue of paired runs measuring whether
memory helps. The route allows only one active run per chat, so arms never run concurrently:
each finished arm hands off to the next inside the `advance` branch, saving under a kept lease
(the same two-writes pattern `approve` uses), which means the existing client poll drives the
whole queue with no client change.

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
11. **The split store is structural, not a promise.** Derived knowledge
    (`extractToolKnowledge`) carries argument *keys* and a classified error token — never
    values, never raw provider text, which can echo document contents. Model-authored rules
    take a second, gated lane through `sanitizeToolClaim`: a claim must name a tool discovered
    in that attempt and share no six-word phrase with the task corpus, or it is dropped (not
    rewritten) and counted in `run.rejectedToolClaims`. Only `kind: 'tool_rule'` reflections
    are ever eligible.
12. **Knowledge follows the same corroboration rule as memory.** `proposed` until a
    *different run* observes it again (`draft.runId !== existing.firstRun`); only `confirmed`
    rules reach a prompt (`formatKnowledgeForPrompt`); a confirmed rule contradicted twice is
    `retired`. Rules are advisory — the discovered schema and `tool-policy.ts` still gate
    every call.
13. **Never cache connection status.** `stripLiveness()` removes `connected` before storage;
    a cache hit recomputes it from `gateway.connections()` and falls through to a real search
    when that is uncertain. A stale `connected: true` would silently defeat invariant 4.
    Schema carry-forward across repair attempts is bounded to one run, still emits a
    `kind: 'search'` trace, and still re-checks authorization.
14. **Ablation arms are frozen and inert.** An arm reads a frozen `memorySnapshot` and
    `readOnlyKnowledge`, does not commit memory (`reflect` skips `curateMemory` when
    `run.experimentId` is set), does not bump `usedCount`, and is silent in the conversation
    (`chatEvent` returns early). An arm that learned from the previous arm would confound the
    comparison it exists to make.
15. **A null result is reported as a null result.** `ablation()` returns
    `insufficient_data` below 3 runs per arm regardless of how the medians fall, and the UI
    styles `memory_hurt` exactly like `memory_helped`. The verdict is computed in the pure
    function so the view cannot spin it. Medians, not means — arm samples are tiny.

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
lib/workbench/tool-knowledge.ts        derive/render/merge tool facts; classifyToolError
lib/workbench/redaction.ts             taskCorpus + sanitizeToolClaim (the lane-B gate)
lib/workbench/metrics.ts               runMetrics, learningTrend, ablation (pure)
lib/workbench/experiment.ts            planExperiment, nextArm, applyArmResult, budgets
lib/workbench/tool-cache.ts            cache key, stripLiveness, applyLiveness (pure)
lib/workbench/{types,schemas,apps,tool-policy,messages}.ts
lib/server/workbench-store.ts          D1 persistence, leases, snapshots
lib/server/workbench-provider.ts       Dependencies wiring: model + tools + knowledge + trace
lib/server/tool-knowledge-store.ts     D1 knowledge store; readOnlyKnowledge for arms
lib/server/tool-cache.ts               D1 schema cache + liveToolkits probe
lib/engine/*                           legacy /lab synthetic harness
components/chat-workspace.tsx          the whole product UI (large; edit surgically)
components/learning-charts.tsx         hand-rolled SVG trend + paired bars
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

## The pure-function seam (do not break this)

Scripts run under `node --experimental-strip-types` and **cannot import anything touching
`cloudflare:workers`**, which rules out all of `lib/server/*`. Tests are pure-function only.
So every capability is a pure function in `lib/workbench/*` behind an injected interface, with
the D1 implementation in `lib/server/*`. `Dependencies.knowledge` is **optional** (`knowledge?`)
precisely so existing tests and `scripts/run-agent.ts` construct dependencies unchanged; every
engine call site is `deps.knowledge?.lookup(...) ?? []` or `.record(...).catch(() => {})`.
An accidental `lib/server/*` import from `lib/workbench/*` breaks `npm test` immediately.

## Testing the loop

`tests/workbench.test.ts` injects a fake `Model` returning canned structured values and a
fake `Tools`, then asserts the full failure → reflection → repair → retest event sequence.
Add cases there rather than mocking HTTP.
