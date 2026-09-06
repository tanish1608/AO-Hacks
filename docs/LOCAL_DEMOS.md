# Local finance demos

Use `http://localhost:3000`. This work was not deployed. The hosted presentation task and its completed run were copied into local D1, preserving their IDs. Existing local tasks and hosted data were retained. Database backups live in the ignored `outputs/local-migration` directory.

## Recording flow

1. Open **Orders to invoice drafts**. Scroll through the first test, its repair, and the independent review that caught missing reporting fields despite a passing workflow rubric. The follow-up correction and passing review remain in the same conversation.
2. Open **My runs**, choose **Use demo Excel input**, expand the attachment to review extracted values, and run the architecture. The output includes three draft invoices, totals separated by currency, a duplicate line, and a held order. Download the final Markdown output. No invoice is posted or sent.
3. Open **Reconcile deposits, fees and timing**. Show the USD 795 bank movement bridge, a many-to-one processor deposit, a USD 30 fee, the duplicate ledger row, an uncleared check and an unexplained USD 75 debit.
4. Open **Cash runway with delayed collections**. Show the baseline and delayed-collection scenario. The downside first breaches the operating buffer in week 2 and needs USD 2,000 in week 3 to restore the buffer.

The three Excel workbooks are downloadable from the home screen and their matching manual-run panels. They contain synthetic data, require no connected accounting accounts, and use no Zoho Books tools. XLSX extraction reads saved cell values, including formula caches. It does not calculate Excel formulas, run macros, fetch workbook links, or include embedded images. Review the extracted text before running.

## Evidence and limits

`FINANCE_DEMO_EVIDENCE.json` contains real model usage, workflow-rubric results and separate model reviews against hand-calculated fixture expectations. All three final test outputs passed that independent review. The earlier invoice review failure is retained. These are fixed demo cases, not held-out benchmarks or production accuracy estimates. The independent reviewer uses the same configured Gemini model; its calls are recorded separately from run metrics. Tool-free demos do not measure cross-task tool learning.

The completed backend's `ABLATION_EVIDENCE.json` remains a directional task-memory experiment at three pairs: 3/3 versus 2/3 completions. Memory-on's median reported model cost was higher. This does not establish a cost improvement or owner-scoped tool-learning improvement.

## Review fixes

- Enabled the `experiment` action in the API allowlist; the implemented handler was unreachable from the Learning tab.
- Tool knowledge is now copied at experiment start and held constant in both task-memory arms. Missing legacy snapshots produce no tool knowledge. Shared schema caching is disabled for ablation arms to avoid warming one arm from the other.
- Memory digests hash content, not only record IDs. Start guards require actually retrievable task memory.
- An external-write request ends the experiment before clearing its pending action. Repeated arm-result application cannot double-count spend.
- Paused arms are excluded from A/B measurements. Completed manual runs do not count as passed evaluations.
- Cache liveness falls back to discovery when an app's status is absent, including account-free search tools that may be omitted from connected-account listings.

Connection prompts appear in chat for unlinked workflow apps. Automatic advancement waits until connection status is verified. OAuth consent remains with the user. The local callback keeps the task ID so the workflow can continue after connecting.

## Reproduce

Run `node --experimental-strip-types scripts/finance-demos.ts` with the configured local model environment to generate new demo histories in `outputs/finance-demos`. `--resume` skips finished fixtures. `--repair` applies the invoice reporting correction to a failed independent review while retaining prior runs. This is a demo harness, not a general replacement for the application's bounded repair loop.

`python3 scripts/import-local-snapshots.py --owner <local-owner-id> <snapshot.json> ...` backs up local D1 and imports completed histories. It never contacts hosting and preserves tasks whose IDs already exist.
