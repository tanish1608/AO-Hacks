# Product foundation

Branch: `product/auth-and-landing`. Deployed to Cloud Run with application-level
accounts; still a single-tenant-per-account product, not a team offering.

## Implemented

| Area | Behavior |
|---|---|
| Home | Chat composer with recent workflow conversations in the sidebar |
| Run review | Approvals, unknown external outcomes, pauses, blockers, and failures remain inside each workflow conversation |
| Creation | Describe a reusable process, then edit and test in the existing conversation |
| Rules | User-authored, bounded workflow rules; copied into each run and passed to design, execution, evaluation, reflection, and repair |
| Isolation | Rules remain chat-scoped and are added to the existing cross-task content-overlap filter |
| Setup | Server-side live connection check before sample generation or agent execution; no cached authorization |
| Recovery | Missing-input, connection, and budget blocks stop before extra evaluator/reflection calls |
| Terminology | Workflow, steps, runs, rules, and insights replace lab-facing navigation |
| Research | Historical report and experiments preserved under docs; the synthetic optimizer, its routes and `lib/engine/` were removed |
| Accounts | Email and password sign-up, PBKDF2 hashes, digest-only session tokens, per-address sign-in throttling, one message for unknown address and wrong password |
| Surfaces | Public landing at `/`, workspace at `/app`, `/login` and `/signup`; published workflow links require an account |
| Repository | Runtime SQLite and build metadata removed from tracking without deleting local files |

No data migration or schema replacement was needed. Existing tasks, versions, and evidence remain readable. No external business actions were executed during this product iteration.

## What the rules feature does not claim

Saving a rule is an explicit user instruction, not an automatically proven improvement. Rules cannot grant tool authorization, bypass the write-review gate, or rewrite a run's frozen evaluation rubric. Changing a rule does not itself prove compliance; the user should test the change. The current implementation passes rules as model context. A future release needs executable policy checks and rule-specific regression cases before automatically promoting changes.

The existing six-word overlap filter now includes business rules, but it is a heuristic, not a formal privacy guarantee. Derived tool knowledge still excludes argument values by construction. More stringent controls on model-authored cross-task knowledge remain appropriate before customer deployment.

## Verified in this iteration

- 88 automated tests, TypeScript checking, lint, and the production build pass.
- Local API checks confirm rule persistence, normalization, rejection of stale revisions (409), and rejection of invalid rules (400). The disposable verification workflow was removed afterward; existing workflows were untouched.
- Automated tests cover connection preflight without model spend, stopping on missing input, frozen rule snapshots, rule validation, content-overlap protection, review status semantics, and standalone authentication policy.
- The actual workspace SQL returns the expected saved workflows for their owner and no records for an unrelated owner. Query plans use the existing chat-owner and run-chat indexes.
- Browser checks cover the saved-workflow library, the three existing review items, opening an existing workflow, and the Rules tab.
- Existing provider and execution tests are retained; historical evaluation scores are not retroactively presented as product reliability.

## Before a public customer launch

1. **Durable execution.** Move advancement from the open browser into authenticated background workers with job leases, retries, cancellation, and recovery after worker death. An active run currently needs its workflow open.
2. **Team identity.** Email and password accounts now exist, but there is no team membership, no roles, no email verification, and no password reset. A forgotten password currently has no self-service path. Test unauthorized access across every data and connector boundary before inviting anyone outside a single owner.
3. **Shared persistence.** Use transactional shared storage appropriate to the hosting target. The old single-instance SQLite snapshot adapter is not a horizontally scalable design.
4. **Verified outcomes.** Extend delivery checks beyond Zoho and check expected write counts and all relevant fields, not only existence of a successful tool receipt.
5. **Financial determinism.** Use exact decimal arithmetic and source-row reconciliation for invoices. Model reasoning must not be the final monetary authority.
6. **Improvement releases.** Convert reviewer corrections into proposed scoped rules, independently authored regression cases, held-out comparisons, and reversible workflow releases. Saved regression cases, candidate testing, explicit apply, and rollback are now implemented; see WORKFLOW_RELEASES.md. Independently authored held-out comparisons and automatic correction extraction remain outstanding.
7. **Operational controls.** Add tenant usage limits, complete billing attribution, deployment alerts, retention/deletion controls, and restore drills. Review the existing dependency audit before selecting a production runtime.

Do not describe this branch as public-production-ready until these launch gates are implemented and independently exercised.

## Follow-up: tested workflow releases

The next iteration adds reviewed external actions, saved regression cases, isolated correction candidates with bounded repairs, apply/rollback, and fixed-version runnable links. See [the feature report](WORKFLOW_RELEASES.md) and [live evidence](WORKFLOW_RELEASE_EVIDENCE.json). Earlier verification counts above describe the foundation checkpoint.

## Conversation-first correction

The workspace home is the chat composer. Recent workflows reopen their conversations from the sidebar; the separate library and review queue are no longer navigation surfaces. Host lives in the conversation header and opens a copyable-link dropdown. The shared page puts app connections and run inputs on the left and the agent architecture on the right. Visitor isolation remains enforced, but starting it is automatic when Run workflow is pressed.

Shared links work now. Under Identity-Aware Proxy they did not: IAP authenticated the whole origin, so a recipient was refused before the application ever saw the request, and both published links sat at zero uses. Moving authentication into the application made the link account-only instead of origin-only.
