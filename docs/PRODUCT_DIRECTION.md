# Agent Foundry: conversational agent engineering

The primary product is a chat workspace. Each conversation owns a goal, an editable agent graph, a frozen evaluation rubric per run, execution history, and an evidence-backed memory. A right-hand graph canvas shows agents, their dependencies, and the Composio tools used by each node. Gemini 3.8 Flash is the default model.

## Learning loop

1. Design a graph from the goal, connected toolkits, conversation, and relevant memory.
2. Freeze the rubric and version of the graph for a run. Validate the DAG and resource limits.
3. Execute nodes. Discover actual third-party tool schemas through a user-scoped Composio session; do not invent tool names or arguments. Preserve each tool observation.
4. Independently assess outputs against the frozen rubric. Validate evidence references and tool-result provenance. An LLM rubric score is not calibrated accuracy.
5. Reflect on concrete failure traces; propose scoped memory entries with evidence, and update the graph for the next bounded attempt.
6. Preserve attempts and metrics. Stop at the quality threshold, iteration limit, missing authorization, unavailable evidence, or budget. Reuse useful memory in later runs within the same chat.

## Research basis and limits

- Reflexion: verbal feedback becomes episodic memory. https://arxiv.org/abs/2303.11366
- ACE: incremental, structured memory rather than repeatedly overwriting a summary. https://arxiv.org/abs/2510.04618
- GEPA: propose changes from execution feedback and compare candidate performance. https://gepa-ai.github.io/gepa/guides/
- ADAS: executable architecture generation. https://arxiv.org/abs/2408.08435

Tool knowledge is a second, owner-scoped store that accumulates across tasks while task memory stays chat-local. It records argument keys, schema requirements, and classified error tokens derived from traces; model-authored rules pass a redaction gate that drops any claim naming no discovered tool or sharing a six-word phrase with the task. A rule stays proposed until a different run observes it again, and only confirmed rules reach a prompt.

These ideas inform an engineering implementation; this project is not a reproduction of the papers or a claim of equivalent benchmark results. Aggregate task success requires independently labeled cases. Rubric scores are displayed with their checks, provenance, uncertainty, and sample counts. Measuring the causal benefit of memory requires matched runs with and without memory under the same tools and inputs.

## Operational boundaries

Every external tool invocation is routed through Composio. Account authorization is explicit in Settings. External mutations are staged for review before execution, and their results are retained across retries to avoid blind replay. Unknown outcomes pause for reconciliation. No real third-party content is published during automated test runs.

The current deployment target is a private Cloudflare Worker with D1 persistence. Durable checkpoints separate graph progress from browser state; a browser can reconnect and continue. A distributed work queue, tenant quotas, SSO/SCIM, encrypted tenant-owned secrets, externally anchored audit retention, and load/security testing are production acceptance work, not implied by this prototype.

## Current evidence and next learning experiment

The live writing case exposed a word-count error, which a deterministic assertion overrode despite otherwise fluent output. Repair improved its rubric score from 0.60 to 1.00.

A matched ablation now measures the memory effect directly rather than inferring it. One warm-up run populates task memory; that snapshot is frozen and every arm reads it, so no arm learns from another. Arms alternate memory-on/off over one fixed input and one starting graph, tool-free. At three runs per arm: memory-on passed 3/3 on the first attempt, memory-off needed two attempts in every run and passed 2/3. See [ablation evidence](ABLATION_EVIDENCE.json).

This is one task at n=3 and is reported as directional. The first run of this harness returned the opposite verdict and was invalid — the snapshot was captured before any run had populated memory, so both arms were identical. That failure is retained in the evidence file and is why the warm-up and the empty-memory guard exist. Below three runs per arm the comparison reports `insufficient_data` regardless of how the medians fall.

For the next evaluation, hold the graph and memory snapshot fixed, randomize memory on/off across held-out inputs, use externally defined assertions for correctness, and report task pass counts, repeated-run failure rate, total reported tokens/cost including optimization, and p50/p95 elapsed time. Evaluate at least three distinct real app workflows after account authorization. Keep optimization cases separate from final test cases, and never promote a patch by rewriting its rubric.
