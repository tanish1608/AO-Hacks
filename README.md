# Agent Foundry

A conversational workspace for designing, running, evaluating, and improving specialized agents. The primary product is `/`; the original synthetic experiment harness remains at `/lab`.

## Product

- Chat sidebar with isolated task history, workflow versions, and evidence-linked memory.
- Editable React Flow agent canvas with dependencies, roles, assigned Composio toolkits, actual schemas, and execution status.
- Gemini 3.8 Flash generates and modifies workflows. LangGraph advances execution, evaluation, reflection, and targeted repair through persisted checkpoints.
- Composio v3 sessions discover real tool schemas and manage account authorization. No external application is connected until its owner authorizes it in Settings.
- Frozen weighted rubrics combine model judgments with deterministic word-count, required-term, and forbidden-term checks. App-dependent nodes cannot pass without successful tool observations.
- Proposed lessons are scoped to their chat, retrieved by relevance, and supported or contradicted by later-run evidence. Users can confirm, reject, or remove memories.
- Local traces capture tool requests/results, errors, timings, and reported model tokens. LangSmith forwarding is optional and excludes content by default.
- External mutations require review. Durable receipts prevent blind replay within a run. Unknown outcomes require explicit reconciliation before a new run.

## Run locally

Requires Node 22.13+.

```sh
npm install
# Copy .env.example to .dev.vars and set GEMINI_API_KEY and COMPOSIO_API_KEY.
npm exec wrangler -- d1 migrations apply DB --local --config wrangler.local.json
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. Local sign-in is provided by Sites. Production uses authenticated, owner-scoped access. Never commit `.dev.vars` or place provider keys in browser code.

1. Describe a task and its source material or app URLs.
2. Inspect the generated workflow. Click an agent to edit its instruction; use chat to change structure, tools, or requirements.
3. Connect required accounts in Settings. Inspect the evaluation criteria and run controls.
4. Run the workflow. Review proposed external writes as they appear.
5. Inspect Runs for checks and logs, and Memory for evidence-linked lessons. Run again with memory on or off for an exploratory comparison.

The current preview advances checkpointed steps while the selected task is open and Continue is enabled. Closing it saves progress; reopen and Continue to resume. A durable background queue is a production deployment requirement, not implemented by keeping a browser alive.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run benchmark
python3 scripts/smoke-workbench.py  # live Gemini; no external app writes
node --experimental-strip-types scripts/check-composio.ts
```

`npm run agent:run -- "your supplied-content task"` runs a tool-free workflow from the terminal. Use the web UI for connected apps and write review. `npm run benchmark` runs the explicitly labeled synthetic deterministic reference harness across analytics, customer operations, and scheduling.

Lint covers application code and tests. Generated Shadcn UI primitives and the unchanged generated mobile hook are excluded rather than rewritten. The dependency audit has no high/critical advisories; four moderate entries arise from the same development-only esbuild issue through drizzle-kit. No force downgrade was applied.

## Evidence and measurement

See [live run evidence](docs/LIVE_RUN_EVIDENCE.json), [repeat evidence](docs/REPEAT_RUN_EVIDENCE.json), and [product direction](docs/PRODUCT_DIRECTION.md). One live writing task improved its frozen rubric score from 0.60 to 1.00 after a deterministic word-count violation triggered a repair (159 words to 181 within a required 160–220 range). A repeat still needed repair (157 to 194 words), so memory is **not yet shown to reduce attempts or cost**. An intervening repeat hit a provider token limit; transport truncation now has one bounded retry with both attempts included in usage.

Rubric score is not calibrated accuracy. Measured task accuracy requires independent, held-out cases and ground truth. Repeated-run reliability must include failures. Speed and cost comparisons should use matched inputs, fixed graphs, repeated trials, and a fixed memory snapshot; the supplied live examples are integration evidence, not a generalization benchmark or a causal memory ablation.

Default Gemini text cost estimates use the [published introductory rates](https://ai.google.dev/gemini-api/docs/pricing), verified September 5, 2026: $0.75 per million input tokens and $3.75 per million output tokens, including thinking. The fallback expires January 1, 2027. Set explicit operator rates to override it. Free-tier discounts, app fees, unreported failed requests, and infrastructure costs are not modeled. Older stored runs retain their original pricing state.

## Production acceptance

The implementation has authenticated ownership, D1 migrations, revision/lease concurrency control, checkpoints, capability restrictions, schema validation, explicit external-action review, bounded loops, and idempotency receipts. It is a working engineering prototype, not a certified enterprise service.

Before enterprise rollout: deploy a durable work queue and watchdog, paginate/archive trace storage beyond the preview's 30-run window, add tenant quotas and stronger billing controls, enforce organization policies and roles, implement credential rotation and connector revocation flows, add SSO/SCIM as required, test account deletion/export, anchor audit retention externally, run load/security testing, and validate real workflows using authorized app accounts. Live Google Docs-to-PPTX export and real cross-domain tool-learning evaluations remain unverified until those accounts and fixtures are available.

Optional WebMCP tools expose task listing and read-only evidence inspection. Registration is feature-detected; browser-side WebMCP discovery was not verified in this session. Browser visual/interaction QA was not performed.
