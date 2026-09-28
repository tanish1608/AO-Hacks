'use client';
import { useState } from 'react';
import type { Chat } from '@/lib/workbench/types';
import type {
  RegressionCase,
  RegressionCheck,
} from '@/lib/workbench/improvement';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
export default function WorkflowTests({
  chat,
  disabled,
  onAction,
  onResults,
}: {
  chat: Omit<Chat, 'sessionId'>;
  disabled: boolean;
  onAction: (action: string, body: Record<string, unknown>) => Promise<unknown>;
  onResults: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [input, setInput] = useState(''),
    [expected, setExpected] = useState(''),
    [kind, setKind] = useState<RegressionCheck['kind']>('contains'),
    [path, setPath] = useState(''),
    [rule, setRule] = useState('');
  const [heldOut, setHeldOut] = useState(false);
  const [editing, setEditing] = useState<string | null>(null),
    [extraChecks, setExtraChecks] = useState<RegressionCheck[]>([]),
    [formOpen, setFormOpen] = useState(false);
  const cases = chat.regressionCases ?? [],
    suite = chat.improvement;
  async function addCase() {
    const c: RegressionCase = {
      id: editing ?? crypto.randomUUID(),
      name,
      input,
      ...(heldOut ? { heldOut: true } : {}),
      checks: [
        ...extraChecks,
        ...(expected.trim()
          ? [
              {
                kind,
                value: expected,
                ...(kind.startsWith('json_') ? { path } : {}),
              },
            ]
          : []),
      ],
    };
    if (
      await onAction('regression', {
        cases: editing
          ? cases.map((x) => (x.id === editing ? c : x))
          : [...cases, c],
      })
    ) {
      setName('');
      setInput('');
      setExpected('');
      setExtraChecks([]);
      setEditing(null);
      setFormOpen(false);
    }
  }
  return (
    <section className="workflow-rules test-workbench">
      <h2>Test before you trust a change</h2>
      <p>
        Save representative inputs and explicit expectations. A candidate must
        pass every saved case on the same workflow version. Model rubric scores
        remain separate from these checks.
      </p>
      <ol className="case-list">
        {cases.map((c) => (
          <li key={c.id}>
            <strong>
              {c.name}
              {c.heldOut ? ' · held-out' : ''}
            </strong>
            <p>
              {c.checks
                .map(
                  (k) => `${k.kind}: ${k.path ? k.path + ' = ' : ''}${k.value}`,
                )
                .join('; ')}
            </p>
            <details>
              <summary>Saved input</summary>
              <pre>{c.input}</pre>
            </details>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setEditing(c.id);
                setName(c.name);
                setInput(c.input);
                setExtraChecks(c.checks);
                setHeldOut(Boolean(c.heldOut));
                setExpected('');
                setFormOpen(true);
              }}
            >
              Edit case
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || cases.length === 1}
              onClick={() =>
                void onAction('regression', {
                  cases: cases.filter((x) => x.id !== c.id),
                })
              }
            >
              Remove case
            </Button>
          </li>
        ))}
      </ol>
      <details
        open={formOpen}
        onToggle={(e) => setFormOpen(e.currentTarget.open)}
      >
        <summary>
          {editing ? 'Edit regression case' : 'Add a regression case'}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addCase();
          }}
        >
          <label className="review-check">
            <input
              type="checkbox"
              checked={heldOut}
              onChange={(e) => setHeldOut(e.target.checked)}
            />
            Held-out check: run once, reject on failure, never repair against
            this case.
          </label>
          <label>
            Case name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Missing billing address"
            />
          </label>
          <label htmlFor="case-input">
            Input
            <Textarea
              id="case-input"
              required
              value={input}
              maxLength={12000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a small, representative input or the input that failed."
            />
          </label>
          {extraChecks.map((check, i) => (
            <p key={i}>
              {check.kind}: {check.path ? check.path + ' = ' : ''}
              {check.value}{' '}
              <button
                type="button"
                onClick={() =>
                  setExtraChecks(extraChecks.filter((_, index) => index !== i))
                }
              >
                Remove expectation
              </button>
            </p>
          ))}
          <label>
            Expectation
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as RegressionCheck['kind'])
              }
            >
              <option value="contains">Output contains</option>
              <option value="excludes">Output excludes</option>
              <option value="json_number">Exact number in JSON</option>
              <option value="json_string">Exact text in JSON</option>
            </select>
          </label>
          {kind.startsWith('json_') && (
            <label>
              JSON field path
              <input
                required={Boolean(expected.trim())}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="invoice.total"
              />
            </label>
          )}
          <label>
            Expected value
            <input
              required={!extraChecks.length}
              maxLength={1000}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder={
                kind === 'json_number' ? '118.80' : 'Held for missing address'
              }
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={
              disabled ||
              !expected.trim() ||
              extraChecks.length >= 9 ||
              (kind.startsWith('json_') && !path.trim())
            }
            onClick={() => {
              setExtraChecks([
                ...extraChecks,
                {
                  kind,
                  value: expected,
                  ...(kind.startsWith('json_') ? { path } : {}),
                },
              ]);
              setExpected('');
              setPath('');
            }}
          >
            Add another expectation
          </Button>
          <Button
            disabled={
              disabled ||
              (!editing && cases.length >= 5) ||
              (!extraChecks.length && !expected.trim())
            }
          >
            Save case
          </Button>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setName('');
                setInput('');
                setExpected('');
                setExtraChecks([]);
              }}
            >
              Cancel editing
            </Button>
          )}
        </form>
      </details>
      <label htmlFor="candidate-rule">
        Correction to try
        <Textarea
          id="candidate-rule"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          maxLength={1000}
          placeholder="Hold customers without a billing address. Do not guess an address."
        />
      </label>
      <p className="quiet-text">
        This remains a candidate until you apply it. Up to 3 full-suite rounds,
        2 attempts per regression case (1 for held-out checks), and 120,000
        tokens checked between cases. Tests allow reads, but never external
        writes. Keep the workflow open while testing.
      </p>
      <Button
        disabled={disabled || !cases.length}
        onClick={() =>
          void onAction('improvement', { operation: 'start', rule })
        }
      >
        Test and improve candidate
      </Button>
      {suite && (
        <section className="suite-results">
          <h3>Candidate: {suite.status}</h3>
          <p>
            {suite.error ??
              `${suite.results.length} case runs · round ${Math.min(suite.round, suite.maxRounds)} of ${suite.maxRounds} · ${suite.tokens.toLocaleString()} tokens in finished cases`}
          </p>
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Round</th>
                <th>Result</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {suite.results.map((r) => (
                <tr key={r.runId}>
                  <td>{suite.cases.find((c) => c.id === r.caseId)?.name}</td>
                  <td>{r.round}</td>
                  <td>{r.passed ? 'Passed' : 'Failed'}</td>
                  <td>
                    <button onClick={() => onResults(r.runId)}>View run</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suite.status === 'passed' && (
            <>
              <p>
                All saved cases passed the same candidate. This checks known
                examples; it does not establish accuracy on unseen work.
              </p>
              <Button
                disabled={disabled}
                onClick={() =>
                  void onAction('improvement', { operation: 'apply' })
                }
              >
                Apply tested correction
              </Button>
            </>
          )}
        </section>
      )}
      {chat.rollback && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => void onAction('rollback', {})}
        >
          Undo last correction release
        </Button>
      )}
    </section>
  );
}
