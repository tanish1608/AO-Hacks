# Agent Foundry: startup restart review

This review covers the preserved hackathon evidence, the final Cloud Run database, and a new OpenRouter smoke run. It does not treat model rubric scores as measured customer accuracy.

## What changed

- Main workflows, command-line runs, finance demos, ablation scripts, and the legacy lab can use OpenRouter. Local configuration now selects `openai/gpt-4o`.
- The API key is stored only in the ignored `.dev.vars`. The previous Gemini key was removed from that local file. Explicit provider selection never silently falls back to another provider.
- Structured JSON is requested and validated against the caller's schema. Truncated responses have one bounded retry; usage from both calls is retained. The legacy lab retains its caller-supplied token limit and does not retry automatically.
- OpenRouter cost comes from the provider response. Missing billing stays unknown. Historical Gemini prices and results are unchanged.
- The old `agent-foundry` Cloud Run service in `ao-hacks/us-central1` was deleted. The database and service configuration were backed up before deletion, and the database was downloaded again afterward. SQLite integrity checks passed.
- The Google Cloud project, database buckets, container repository, and secrets remain. Removing the running service does not remove all storage charges. No replacement deployment was created.

The provider implementation follows [OpenRouter's API reference](https://openrouter.ai/docs/api/reference/overview).

## What the saved runs actually show

The hosted database contains **13 chats and 29 runs**. Local Workers history has 12 chats and 28 runs; the Node adapter database contains two diagnostic chats with no agent runs. Each database has its own backup under `work/startup-revisit-20260926/`. They were not blindly overwritten or merged across owners.

| Mode | Completed | Blocked | Failed | Total |
|---|---:|---:|---:|---:|
| Tests | 11 | 1 | 2 | 14 |
| Manual executions | 6 | 0 | 0 | 6 |
| Older runs without an explicit mode | 5 | 3 | 1 | 9 |
| Total | 22 | 4 | 3 | 29 |

“Completed” is a runtime state, not an independently verified success rate. Manual executions do not receive the same evaluation as tests. Missing-input blocks can be correct behavior. These heterogeneous runs are not a benchmark population.

Five runs contain successful external-tool traces. Three contain creation calls: two Google Slides creations and one Google Docs creation. Those traces establish returned tool execution, not independent audits of the resulting documents. Most other runs exercise document/text reasoning without external writes.

Across the stored runs, reported usage totals **909,415 tokens**. Cost is non-null in 27 records and sums to **$1.140895**. That is a historical recorded subtotal, not an invoice or complete project spend: two costs are unknown, design calls and separate scripts may be outside the run totals, and the failed credential call records zero usage.

### The latest failure

The September 10 run (`2a733cf6-f895-4237-a03f-757cb71d3247`) failed before producing an evaluation because Gemini returned HTTP 401. The new OpenRouter live run confirms the replacement credentials and provider path work.

### The invoice failure was an evaluation failure too

Run `1133136c-39e8-4491-8c41-934d0ae24c4d` reached **252,082 reported tokens** across three attempts and failed at the run ceiling. Its stored judge score was 1.0 despite zero created invoices: it rewarded preparation and simulation rather than delivery.

The later run `f2b95250-c3fa-445c-809a-ea7ecf1e491d` correctly stopped with score 0 and a blocked verdict. It still consumed **132,377 tokens**, indicating that missing customer/tax configuration should be checked much earlier.

The EUR 600 Zoho draft in `ZOHO_LIVE_EVIDENCE.json` was created through a separately authorized connector repair, verified as draft with email/reminders off. It must not be presented as an autonomous workflow success. USD groups remained held because tax configuration was unavailable, and a customer with no billing address remained held.

### Memory helped one small task, but did not lower cost

The separate three-pair experiment in `ABLATION_EVIDENCE.json` used one writing task and one fixed input. Memory-enabled runs passed 3/3 in one attempt; controls passed 2/3 and needed two attempts each. Median tokens decreased 7.9%, but median estimated cost increased 25.3%. Latency was almost unchanged. This is promising directional evidence for task memory, not proof of general cross-task tool learning or a cost advantage.

### Hosting logs

The available 30-day error sample contained ten entries: eight IAP access denials, one historical service-not-found event, and one HTTP 502. These are separate from agent evaluation failures. The final service configuration used `AUTH_MODE=open`; that configuration is unsuitable for a production service handling separate customers.

## Fresh OpenRouter verification

A structured workflow-generation call completed in about 2.8 seconds and reported $0.004385. A separate tool-free end-to-end run extracted meeting action items, preserved Alice/Friday, and marked missing details as unspecified. It completed on its first attempt with a rubric pass and **5,681 tokens / $0.0197** in run usage. The design call for that run is outside its run usage, so $0.0197 is not the complete creation-plus-execution cost. No third-party app writes were performed.

The full payload and traces are preserved locally in `work/startup-revisit-20260926/openrouter-workflow.json`. A smoke run proves integration, not production reliability.

## Recommended next product slice

Based on these runs, start with one reviewable workflow: **spreadsheet orders to verified invoice drafts**. Keep the general agent builder underneath it, while making the customer-facing promise specific and measurable.

1. Collect customer, currency, tax, and connection requirements before an expensive run begins. Show actionable blockers immediately.
2. Calculate money in deterministic decimal code and reconcile every source row. An LLM can interpret an exception; it should not be the final arithmetic authority.
3. Distinguish planned, prepared, approved, created, and verified results. Require provider IDs and read-back for every claimed write, with expected counts and line totals.
4. Build an independently authored, held-out set of customer-like inputs before expanding connectors. Measure incorrect invoices, missed exceptions, duplicate writes, review time, cost, and latency separately.
5. Replace shared/open identity and single-instance SQLite snapshot hosting with authenticated tenant isolation and durable shared persistence before accepting external customers.

## Verification and remaining debt

At the provider-migration checkpoint, 81 automated tests, TypeScript checking, and a production build passed. The seven new OpenRouter cases cover schema validation, credential redaction, missing usage/cost, truncation accounting, and provider selection. The 12 pre-existing explicit-`any` lint errors in `zoho-tools.ts` and its tests were subsequently fixed in the startup-foundation iteration, which passes 88 tests and lint. Dependency installation also reported existing audit findings; no unrelated dependency upgrades were attempted.
