# Agent Foundry

A conversational workspace for designing, running, evaluating, and improving specialized agents. The primary product is `/`; the original synthetic experiment harness remains at `/lab`.

## Product

- Light, conversation-first workspace with isolated task history, workflow versions, and evidence-linked memory. Task URLs reopen the same conversation after refresh.
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
3. Choose apps from the icon dropdown and connect required accounts in Settings. App selection is applied with your next message.
4. A generated sample test starts automatically after each workflow design or chat revision. Agent outputs, checks, reflections, and repairs appear in chat. Failed checks trigger another attempt with the same sample, up to the limit. **View test results** opens detailed checks and logs.
5. Choose **Run with my input** in the workflow panel, paste your own content or attach PDF/DOCX/TXT/MD/CSV/JSON documents, review their extracted text, and run the architecture once. Attach up to three files (10 MB each); combined text is limited to 12,000 characters. Scanned PDFs require OCR first. Manual inputs and outputs stay under **My runs**; they do not trigger test repair or memory updates. Continue chatting to revise the same task. On narrow screens, switch between **Chat** and **Workflow**.

The current preview advances checkpointed steps while the selected task is open and Continue is enabled. Closing it saves progress; reopen and Continue to resume. A durable background queue is a production deployment requirement, not implemented by keeping a browser alive.

**Recovery checks** posts six deterministic fault-injection checks in the task chat. During actual tests, bounded transient read retries and stagnation stops also appear in chat, with logs in detailed results. See [the applied research and scope](docs/RECOVERY_RESEARCH.md).

## App catalog, search, and CFO starters

The icon picker has Featured, Finance & accounting, and All apps views. The complete 1,505-toolkit catalog was retrieved from Composio on September 6, 2026; the app displays that bundled snapshot, not a live guarantee of account availability. `node --experimental-strip-types scripts/sync-app-catalog.ts` refreshes it from authenticated, paginated Composio metadata. Selected apps still require authorization where applicable, with at most eight apps per task.

Web Search uses Composio's public Exa/Tavily/DuckDuckGo tools without a separate account connection. Google Search (SerpApi) exposes actual Google search tools and requires the owner's SerpApi connection. These providers are labeled separately. Public search aliases map only a reviewed list of search/read slugs; privileged Composio meta operations remain excluded.

CFO starter prompts cover ledger reconciliation, invoice review, and weekly cash reporting. They select relevant apps and prepare a draft prompt; they do not invent company data or initiate payments. Finance app account authorization and end-to-end finance runs remain operator steps, not completed demo evidence.

The LLM judge already ran as a separate evaluation call. Chat now labels model-judged versus deterministic checks, and detailed results show the judge model, evidence gates, and deterministic overrides. Memory remains active internally but is no longer a workflow-panel tab.

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

Optional WebMCP tools expose task listing and read-only evidence inspection. Registration is feature-detected. Browser QA verified WebMCP registration, desktop and 466px layouts, visible graph nodes, chat test outputs and evaluated checks, app icon selection, and connection status. A live Gemini test completed through chat; regression tests verify the failure → reflection → repair → retest event sequence.
