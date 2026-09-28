# Foundry

**Reusable workflows, with review and evidence built in.**

Foundry turns a description of repeatable work into an editable workflow. Test it with a sample, run it on your own documents, review proposed actions in connected apps, and save the rules that matter to your process.

## Using the workspace

1. **Create a workflow.** Describe its inputs, expected result, and exceptions. Select only the apps it needs.
2. **Check the setup.** Connect accounts in Settings. The server checks connections before spending model tokens on a new attempt.
3. **Test and inspect.** Sample runs and their evaluations appear in the conversation. A test result is separate from a real execution.
4. **Add your rules.** Save workflow-specific instructions in Rules. New runs freeze those rules; past evidence stays unchanged.
5. **Run with your input.** Upload documents or paste content. Review proposed external writes before they execute.
6. **Return to a conversation.** Open any saved workflow from Recent workflows in the sidebar. Chat remains the home screen.

Rules guide the model; they are not independently proven policies. Test after changing them. Missing input or connections stops a run instead of spending more model calls on a judge and repair loop.

## Run locally

Use Node 22.13 or newer. Install the locked dependencies with `npm ci`. For a new installation only, copy `.env.example` to `.dev.vars`; keep an existing configuration intact.

Configure these server-only values in `.dev.vars`:

```dotenv
FOUNDRY_PROVIDER=openrouter
FOUNDRY_MODEL=openai/gpt-4o
OPENROUTER_API_KEY=your-key
COMPOSIO_API_KEY=your-key
```

Composio is needed for connected apps, not document-only workflows. Each external account still requires authorization. LangSmith is optional; local traces are always available.

```sh
npm exec wrangler -- d1 migrations apply DB --local --config wrangler.local.json
npm run dev -- --host 127.0.0.1 --port 3000
```

Open [the workspace](http://127.0.0.1:3000). The local Sites development integration supplies a development identity. Keep the workflow open while it runs: execution is currently advanced by the client, not an independent background worker.

## Engineering

- React/Vinext workspace, React Flow canvas, and owner-scoped SQLite/D1 state.
- Structured model responses through OpenRouter; explicitly selectable Gemini support for historical experiments.
- Composio tool discovery and account authorization, reviewed writes, and durable dispatch receipts.
- Frozen per-run evaluation criteria, bounded attempts, isolated task memory, and separate tool knowledge.
- Recent workflows in the sidebar query compact run summaries without downloading full trace histories.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run agent:run -- "your task"` runs a document-only workflow from the terminal. The historical synthetic benchmark remains available with `npm run benchmark`; its old `/lab` page redirects to the workspace.

## Release status

This branch is a product foundation for private use, **not a public multi-tenant launch**. Shared `AUTH_MODE=open` is disabled. The standalone Node adapter binds to localhost by default and rejects publicly exposed Sites-header authentication. IAP mode requires a configured verification audience. The old Google Cloud Run service has been retired; no replacement is deployed.

Before inviting external customers, complete durable background jobs, production identity and team membership, deployment-specific persistence, independent held-out evaluations, and recovery tests. Model-authored invoice arithmetic must still be replaced with deterministic decimal calculations before relying on it for production financial work.

Local databases, secrets, and generated build state are excluded from future commits. Existing run data is preserved locally; removing files from tracking does not erase earlier Git history.

## Evidence and direction

- [Product foundation and launch gates](docs/PRODUCT_FOUNDATION.md)
- [Review of the saved runs and OpenRouter migration](docs/STARTUP_REVIEW_2026-09-26.md)
- [Historical technical report and experiments](docs/TECHNICAL_REPORT.md)
- [Retired Google Cloud deployment](docs/DEPLOY_GCP.md)

Historical results remain labeled with their original model and experimental scope. A completed run, a judge score, and a verified external result are different things.

## Tested corrections and shareable workflows

Use **Tests** to save inputs and deterministic expectations, test a candidate correction, and apply it only after the full suite passes one version. **Host** in the chat header creates a fixed workflow link in a copyable dropdown. Visitors see app connections and run inputs on the left, with the agent architecture on the right. Each visitor uses their own connections; the run is created automatically when they press Run workflow. See [workflow releases](docs/WORKFLOW_RELEASES.md) for the user flow, limits, and live evidence.

## Startup demo workflows

The current demo workspace is intentionally focused on useful startup operations rather than finance examples:

- **Customer feedback:** deduplicate feedback, isolate conflicting IDs, find urgent risks, and prioritize product experiments.
- **Market research:** compare dated evidence, surface contradictory competitor claims, and decide whether to launch or validate first.
- **Launch readiness:** trace dependencies, detect unverified “done” tasks, and create a recovery plan without sending communications.

Each workflow ships with a fictional source packet, deterministic checks, and a reserved follow-up case. The packets are synthetic and clearly labeled; replace them with your own material before relying on a result.
