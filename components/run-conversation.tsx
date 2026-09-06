'use client';
import ReactMarkdown from 'react-markdown';
import { Check, FlaskConical, GitBranch, X, ChevronRight } from 'lucide-react';
import type { Message, Run } from '@/lib/workbench/types';
export default function RunConversation({
  message,
  run,
}: {
  message: Message;
  run?: Run;
}) {
  const attempt = run?.attempts.find((a) => a.id === message.attemptId);
  const node = attempt?.workflow.nodes.find((n) => n.id === message.nodeId);
  const evaluation = attempt?.evaluation;
  const terminal =
    node && !attempt?.workflow.nodes.some((n) => n.dependsOn.includes(node.id));
  if (message.kind === 'evaluation' && evaluation && run)
    return (
      <article className="chat-test-result">
        <header>
          <FlaskConical size={17} />
          <strong>Attempt {attempt?.iteration} results</strong>
          <span
            className={
              evaluation.verdict === 'pass' ? 'test-pass' : 'test-fail'
            }
          >
            {Math.round(evaluation.score * 100)}% ·{' '}
            {evaluation.verdict === 'pass' ? 'Passed' : 'Needs work'}
          </span>
        </header>
        <p>{evaluation.summary}</p>
        <div className="test-checks">
          {run.rubric.map((c) => {
            const check = evaluation.checks.find((k) => k.criterionId === c.id);
            return (
              <details key={c.id}>
                <summary>
                  {(check?.score ?? 0) >= run.target ? (
                    <Check size={14} />
                  ) : (
                    <X size={14} />
                  )}
                  <span>
                    {c.name}
                    {c.required && <small>Required</small>}
                  </span>
                  <b>{Math.round((check?.score ?? 0) * 100)}%</b>
                </summary>
                <p>{check?.rationale ?? 'No evidence available.'}</p>
              </details>
            );
          })}
        </div>
        {evaluation.issues.map((issue, i) => (
          <p className="test-issue" key={i}>
            {issue}
          </p>
        ))}
        <footer>
          Target {Math.round(run.target * 100)}% ·{' '}
          {attempt?.traces
            .reduce((n, t) => n + t.usage.inputTokens + t.usage.outputTokens, 0)
            .toLocaleString()}{' '}
          tokens ·{' '}
          {(
            (attempt?.traces.reduce((n, t) => n + t.durationMs, 0) ?? 0) / 1000
          ).toFixed(1)}
          s in steps<span>Rubric score; required checks must pass.</span>
        </footer>
      </article>
    );
  if (message.kind === 'agent_result')
    return (
      <article
        className={`chat-agent-result ${terminal ? 'final-output' : ''}`}
      >
        <details open={terminal}>
          <summary>
            <Check size={15} />
            <strong>{node?.name ?? 'Agent output'}</strong>
            <span>
              {terminal ? 'Result' : 'Step complete'} · attempt{' '}
              {attempt?.iteration}
            </span>
            <ChevronRight size={13} />
          </summary>
          <div className="message-content">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
          {attempt && (
            <details className="inline-log">
              <summary>
                Inspect step log (
                {
                  attempt.traces.filter((t) => t.nodeId === message.nodeId)
                    .length
                }
                )
              </summary>
              {attempt.traces
                .filter((t) => t.nodeId === message.nodeId)
                .map((t) => (
                  <details key={t.id}>
                    <summary>
                      {t.name} · {(t.durationMs / 1000).toFixed(1)}s
                    </summary>
                    <pre>{t.output || t.error}</pre>
                  </details>
                ))}
            </details>
          )}
        </details>
      </article>
    );
  return (
    <article className={`chat-event ${message.kind}`}>
      <span className="event-symbol">
        {message.kind === 'run_started' ? (
          <FlaskConical size={16} />
        ) : (
          <GitBranch size={16} />
        )}
      </span>
      <div>
        <strong>
          {(
            {
              run_started: 'Testing the workflow',
              reflection: 'What this attempt taught me',
              repair: 'Revising and testing again',
              run_finished: 'Test finished',
            } as Record<string, string>
          )[message.kind ?? ''] ?? 'Foundry'}
        </strong>
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
    </article>
  );
}
