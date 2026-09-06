# Applied recovery research

The supplied research was reviewed against the existing runtime and primary sources on September 6, 2026.

## What changed

- Category-specific recovery: safe app reads and discovery receive at most two transient retries with bounded exponential backoff and jitter. Authorization and missing-resource failures stop with actionable guidance. Unknown mutations retain the existing review/receipt path and never receive automatic transport retries.
- Stagnation protection: failed requests are compared using canonical argument hashes. Identical failed reads are suppressed before another dispatch. Repeated schema-invalid actions stop rather than consuming all seven model turns. Different arguments are distinguishable.
- Two schema failures exhaust the local repair budget; the frozen evaluator decides whether graph repair is justified. Existing iteration and token limits remain necessary ceilings.
- Partial output and traces remain in the saved run. Recovery decisions are recorded in test chat and detailed traces. Manual runs keep recovery logs in their own results.
- Recovery checks in chat execute six deterministic fault-injection scenarios with no external calls. These are runtime-policy tests, not workflow-quality scores or reliability benchmarks.

## Evidence and scope

The regression suite exercises recovery in the real advance wrapper with injected model/tool responses: transient recovery, denied access, repeated invalid arguments, repeated failing reads, manual isolation, and remaining tool budgets. This demonstrates correct behavior under specified faults; it does not establish general task accuracy or a causal learning improvement. Retry requests add latency and app traffic; they avoid an extra planning call when a transient read succeeds. Recovery retries consume the existing tool budget.

Original model, evaluator, reflection, frozen-rubric, memory, and receipt invariants remain. The parallel editor's owner-scoped learning and A/B work is separate. We did not implement LATS/MCTS, distributed supervision, WAL rollback, or cross-run pass^k estimation in this change. These need an environment where branching is safe, a durable scheduler, or repeated frozen trials. Checkpoint rollback cannot undo an external side effect.

## Primary sources and interpretation

- [Reflexion](https://arxiv.org/abs/2303.11366): feedback and episodic verbal memory support the existing reflection mechanism. Its HumanEval result belongs to the paper's evaluated configuration; it is not evidence for Foundry's accuracy.
- [τ-bench](https://arxiv.org/abs/2406.12045): supports checking final environment state and measuring repeated-run consistency. A single model rubric score and six deterministic policy checks are not pass^k.
- [AWS: Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): supports bounded retries, avoiding retry amplification, and considering side effects. Foundry applies this only to discovered reads and discovery calls, at one recovery layer.

Some numerical claims and blanket statements in the supplied report lack source attribution. In particular, a graph recursion limit does not inherently erase persisted checkpoints, and a separate evaluator prompt using the same model does not establish statistical independence. Those claims were not used as implementation premises.
