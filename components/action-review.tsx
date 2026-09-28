'use client';
import { useState } from 'react';
import type { Run } from '@/lib/workbench/types';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
export default function ActionReview({
  run,
  busy,
  onAction,
}: {
  run: Run;
  busy: boolean;
  onAction: (action: string, body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [note, setNote] = useState('');
  const p = run.pending;
  if (!p) return null;
  const ready = p.status === 'awaiting_approval';
  return (
    <section
      className="action-review"
      aria-label="Review proposed external change"
    >
      <div>
        <strong>
          {ready
            ? 'Approve this external change'
            : 'Check the external outcome'}
        </strong>
      </div>
      <p>{p.description}</p>
      <dl className="review-fields">
        <dt>Connected app</dt>
        <dd>{p.tool.toolkit}</dd>
        <dt>Action</dt>
        <dd>{p.tool.slug}</dd>
        <dt>Step</dt>
        <dd>
          {run.attempts.at(-1)?.workflow.nodes.find((n) => n.id === p.nodeId)
            ?.name ?? p.nodeId}
        </dd>
        {Object.entries(p.arguments)
          .slice(0, 12)
          .map(([key, value]) => (
            <div key={key}>
              <dt>{key.replaceAll('_', ' ')}</dt>
              <dd>
                {typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
              </dd>
            </div>
          ))}
      </dl>
      <details>
        <summary>Inspect the complete request</summary>
        <pre>{JSON.stringify(p.arguments, null, 2)}</pre>
      </details>
      <p className="quiet-text">
        Approval sends exactly this request to your connected account. It does
        not approve later changes. Check recipients, amounts, and destination
        IDs above.
      </p>
      {ready ? (
        <footer>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onAction('reject', { pendingId: p.id })}
          >
            Decline
          </Button>
          <Button
            disabled={busy}
            onClick={() => void onAction('approve', { pendingId: p.id })}
          >
            Approve this change
          </Button>
        </footer>
      ) : (
        <>
          <p>
            The action may already have happened. It will not be automatically
            sent again.
          </p>
          <label htmlFor="review-outcome">
            What did you verify in the connected app?
            <Textarea
              id="review-outcome"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={3000}
            />
          </label>
          <Button
            disabled={busy || note.trim().length < 10}
            onClick={() =>
              void onAction('reconcile', { pendingId: p.id, note })
            }
          >
            Record outcome and stop
          </Button>
        </>
      )}
    </section>
  );
}
