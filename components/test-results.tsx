'use client';
import { useState } from 'react';
import type { Run } from '@/lib/workbench/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
export default function TestResults({
  runs,
  initialId,
  onClose,
}: {
  runs: Run[];
  initialId: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(initialId),
    [index, setIndex] = useState(-1);
  const run = runs.find((r) => r.id === selected) ?? runs[0];
  const attempt =
    run?.attempts[
      index < 0
        ? run.attempts.length - 1
        : Math.min(index, run.attempts.length - 1)
    ];
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="wb-dialog test-results-dialog">
        <DialogHeader>
          <DialogTitle>Test results</DialogTitle>
          <DialogDescription>
            Generated test input, frozen checks, and the evidence behind each
            attempt.
          </DialogDescription>
        </DialogHeader>
        {run && attempt && (
          <>
            <div className="run-selectors">
              <NativeSelect
                aria-label="Test history"
                value={run.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setIndex(-1);
                }}
              >
                {runs.map((r, i) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    Test {runs.length - i} · {r.status}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Test attempt"
                value={attempt.iteration}
                onChange={(e) => setIndex(Number(e.target.value) - 1)}
              >
                {run.attempts.map((a) => (
                  <NativeSelectOption key={a.id} value={a.iteration}>
                    Attempt {a.iteration} ·{' '}
                    {a.evaluation
                      ? Math.round(a.evaluation.score * 100) + '%'
                      : 'Pending'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="run-facts">
              <span>
                <strong>
                  {attempt.evaluation
                    ? Math.round(attempt.evaluation.score * 100) + '%'
                    : 'Pending'}
                </strong>
                rubric score
              </span>
              <span>
                <strong>
                  {(
                    run.usage.inputTokens + run.usage.outputTokens
                  ).toLocaleString()}
                </strong>
                tokens
              </span>
              <span>
                <strong>
                  {run.usage.costUsd === null
                    ? 'Unpriced'
                    : '$' + run.usage.costUsd.toFixed(4)}
                </strong>
                model cost
              </span>
              <span>
                <strong>
                  {(
                    attempt.traces.reduce((n, t) => n + t.durationMs, 0) / 1000
                  ).toFixed(1)}
                  s
                </strong>
                attempt step time
              </span>
            </div>
            <details className="schema-detail">
              <summary>
                Test input ·{' '}
                {run.inputOrigin === 'generated'
                  ? 'generated sample'
                  : 'original task'}
              </summary>
              <p>{run.inputExplanation}</p>
              <pre>
                {run.input ??
                  'This earlier test used the conversation as input.'}
              </pre>
            </details>
            <p>
              {attempt.evaluation?.summary ??
                run.error ??
                'The test is still running.'}
            </p>
            {run.rubric.map((c) => {
              const check = attempt.evaluation?.checks.find(
                (k) => k.criterionId === c.id,
              );
              return (
                <details key={c.id} className="rubric-check">
                  <summary>
                    <span>
                      {c.name}
                      {c.required && <small>Required</small>}
                    </span>
                    <strong>
                      {check ? Math.round(check.score * 100) + '%' : 'Pending'}
                    </strong>
                  </summary>
                  <p>{c.description}</p>
                  <p>{check?.rationale}</p>
                  <small>
                    {check?.verified
                      ? 'Evidence references checked'
                      : 'Evidence not verified'}
                  </small>
                  {check?.evidenceIds.map((id) => (
                    <code key={id}>{id}</code>
                  ))}
                </details>
              );
            })}
            <h3>Step log</h3>
            {attempt.traces.map((t) => (
              <details className="wb-trace" key={t.id}>
                <summary>
                  <strong>{t.name}</strong>
                  <span>{(t.durationMs / 1000).toFixed(1)}s</span>
                </summary>
                <div className="trace-body">
                  <p>Input</p>
                  <pre>{t.input}</pre>
                  <p>Output</p>
                  <pre>{t.output || t.error}</pre>
                </div>
              </details>
            ))}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
