import { recoverRead, fingerprint, type RecoveryEvent } from './recovery.ts';
import { emptyUsage, type Observation } from './types.ts';
export async function runRecoveryChecks() {
  const results: { name: string; passed: boolean; detail: string }[] = [];
  for (const scenario of [
    {
      name: 'Transient read recovers',
      safe: true,
      failures: 1,
      status: 503,
      expectedCalls: 2,
      expectedSuccess: true,
    },
    {
      name: 'Repeated outage stops',
      safe: true,
      failures: 9,
      status: 503,
      expectedCalls: 3,
      expectedSuccess: false,
    },
    {
      name: 'Permission error does not retry',
      safe: true,
      failures: 9,
      status: 403,
      expectedCalls: 1,
      expectedSuccess: false,
    },
    {
      name: 'Missing resource does not retry',
      safe: true,
      failures: 9,
      status: 404,
      expectedCalls: 1,
      expectedSuccess: false,
    },
    {
      name: 'Uncertain write is never retried',
      safe: false,
      failures: 9,
      status: 503,
      expectedCalls: 1,
      expectedSuccess: false,
    },
  ]) {
    let calls = 0,
      success = false;
    const events: RecoveryEvent[] = [];
    try {
      await recoverRead(
        async () => {
          calls++;
          if (calls <= scenario.failures)
            throw new Error(
              `Composio HTTP ${scenario.status}: injected failure`,
            );
          return 'ok';
        },
        scenario.safe,
        (e) => events.push(e),
        async () => {},
      );
      success = true;
    } catch {
      /* Expected fault injection. */
    }
    results.push({
      name: scenario.name,
      passed:
        calls === scenario.expectedCalls &&
        success === scenario.expectedSuccess,
      detail: `${calls} simulated request${calls === 1 ? '' : 's'}; ${events.filter((e) => e.action === 'retry').length} retries; ${success ? 'recovered' : 'stopped'}.`,
    });
  }
  const trace: Observation = {
    id: 'fixture',
    at: '',
    nodeId: 'reader',
    kind: 'tool',
    name: 'READ',
    input: '{"id":"42","limit":3}',
    output: '',
    error: 'failed',
    durationMs: 0,
    usage: emptyUsage(),
    langsmith: 'disabled',
  };
  const same =
    (await fingerprint(trace)) ===
    (await fingerprint({ ...trace, input: '{"limit":3,"id":"42"}' }));
  const different =
    (await fingerprint(trace)) !==
    (await fingerprint({ ...trace, input: '{"id":"43","limit":3}' }));
  results.push({
    name: 'Repeated arguments detected',
    passed: same && different,
    detail: 'Key order is ignored; changed arguments remain distinct.',
  });
  return { at: new Date().toISOString(), results };
}
export function recoveryCheckMessage(
  report: Awaited<ReturnType<typeof runRecoveryChecks>>,
) {
  return `**Recovery checks · ${report.results.filter((r) => r.passed).length}/${report.results.length} passed**\n\nDeterministic fault-injection tests of the runtime policy. No external apps or models were called. These results do not measure your workflow’s accuracy.\n\n| Check | Result | Evidence |\n| --- | --- | --- |\n${report.results.map((r) => `| ${r.name} | ${r.passed ? 'Passed' : 'Failed'} | ${r.detail} |`).join('\n')}\n\nChecked ${report.at}.`;
}
