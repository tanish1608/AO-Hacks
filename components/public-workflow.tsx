'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import DocumentInput from './document-input';
import ActionReview from './action-review';
import WorkflowCanvas from './workflow-canvas';
import { GitBranch, Play, Check, LoaderCircle } from 'lucide-react';
import { AppIcon } from './app-picker';
import { appDefinition } from '@/lib/workbench/apps';
import { combineRunInput, type InputDocument } from '@/lib/workbench/documents';
import type { AgentNode, Chat, Run, Workflow } from '@/lib/workbench/types';
type PublicInfo = {
  title: string;
  description: string;
  steps: Omit<AgentNode, 'instruction'>[];
  apps: string[];
  available: boolean;
};
type Snapshot = { chat: Omit<Chat, 'sessionId'>; runs: Run[] };
type Connections = {
  connections: {
    slug: string;
    connection?: {
      is_active?: boolean;
      isActive?: boolean;
      connected_account?: { status: string };
    };
  }[];
  connectionError: string | null;
};
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw Error(data.error ?? 'Request failed');
  return data;
}
export default function PublicWorkflow({
  id,
  signedIn,
}: {
  id: string;
  signedIn: boolean;
}) {
  const [info, setInfo] = useState<PublicInfo | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connections, setConnections] = useState<Connections | null>(null),
    [input, setInput] = useState(''),
    [documents, setDocuments] = useState<InputDocument[]>([]),
    [extracting, setExtracting] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(true);
  const lock = useRef(false);
  const run = snapshot?.runs[0],
    attempt = run?.attempts.at(-1);
  useEffect(() => {
    let current = true;
    request<PublicInfo>(`/api/workflows/${id}`)
      .then((x) => {
        if (current) setInfo(x);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    const session = new URLSearchParams(window.location.search).get('session');
    if (signedIn && session && /^[a-zA-Z0-9-]{1,80}$/.test(session))
      request<Snapshot>(`/api/chats/${session}`)
        .then((x) => {
          if (x.chat.sourceShare !== id)
            throw Error('This run belongs to another workflow.');
          if (current) setSnapshot(x);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [id, signedIn]);
  async function refreshConnections() {
    try {
      setConnections(await request<Connections>('/api/integrations'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let current = true;
    if (signedIn)
      request<Connections>('/api/integrations')
        .then((x) => {
          if (current) setConnections(x);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [signedIn]);
  async function act(action: string, body: Record<string, unknown> = {}) {
    if (!snapshot || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await request<Snapshot>(
        `/api/chats/${snapshot.chat.id}/${action}`,
        { revision: snapshot.chat.revision, runId: run?.id, ...body },
      );
      setSnapshot(next);
      if (action === 'approve' || action === 'resume' || action === 'run')
        setAuto(true);
      return next;
    } catch (e) {
      setError((e as Error).message);
      setAuto(false);
      try {
        setSnapshot(await request<Snapshot>(`/api/chats/${snapshot.chat.id}`));
      } catch {
        /* retain prior evidence */
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (auto && !busy && run?.status === 'running') {
      const timer = setTimeout(() => void act('advance'), 400);
      return () => clearTimeout(timer);
    }
  });
  async function beginRun() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    let target = snapshot;
    try {
      const combined = combineRunInput(input, documents);
      if (!target || target.runs.length) {
        const result = await request<{ chatId: string }>(
          `/api/workflows/${id}/start`,
          {},
        );
        target = await request<Snapshot>(`/api/chats/${result.chatId}`);
        setSnapshot(target);
        window.history.replaceState(
          null,
          '',
          `/w/${id}?session=${result.chatId}`,
        );
      }
      const next = await request<Snapshot>(`/api/chats/${target.chat.id}/run`, {
        revision: target.chat.revision,
        mode: 'manual',
        input: combined,
      });
      setSnapshot(next);
      setAuto(true);
    } catch (e) {
      setError((e as Error).message);
      setAuto(false);
      if (target) {
        try {
          setSnapshot(await request<Snapshot>(`/api/chats/${target.chat.id}`));
        } catch {
          /* Keep saved input for retry. */
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function connect(toolkit: string) {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ url: string }>(
        '/api/integrations/connect',
        {
          toolkit,
          returnTo: `/w/${id}${snapshot ? `?session=${snapshot.chat.id}` : ''}`,
        },
      );
      window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const apps = info?.apps.filter((slug) => !appDefinition(slug)?.noAuth) ?? [];
  const ready =
    apps.every((slug) =>
      connections?.connections.some(
        (c) =>
          c.slug === slug &&
          (c.connection?.is_active ||
            c.connection?.isActive ||
            c.connection?.connected_account?.status === 'ACTIVE'),
      ),
    ) &&
    (!apps.length || !connections?.connectionError);
  const final = attempt?.states.find(
    (s) => !attempt.workflow.nodes.some((n) => n.dependsOn.includes(s.nodeId)),
  );
  const architecture: Workflow | undefined = info
    ? {
        title: info.title,
        explanation: info.description,
        criteria: [],
        nodes: info.steps.map((step) => ({ ...step, instruction: '' })),
      }
    : undefined;
  const signInUrl = `/signin-with-chatgpt?return_to=${encodeURIComponent(`/w/${id}`)}`;
  return (
    <main className="public-workflow">
      <header>
        <Link href="/">foundry.</Link>
        <span>Workflow</span>
      </header>
      {error && (
        <p className="public-error" role="alert">
          {error}
        </p>
      )}
      {!info ? (
        <p>Loading workflow…</p>
      ) : (
        <>
          <section className="public-intro">
            <h1>{info.title}</h1>
            <p>{info.description}</p>
          </section>
          <div className="hosted-layout">
            <div className="hosted-sidebar">
              <section className="public-card">
                <h2>App connections</h2>
                {!apps.length ? (
                  <p>This workflow is ready to use. No apps to connect.</p>
                ) : (
                  <>
                    <p>Connect the apps this workflow needs.</p>
                    {apps.map((slug) => {
                      const connected = connections?.connections.some(
                        (c) =>
                          c.slug === slug &&
                          (c.connection?.is_active ||
                            c.connection?.isActive ||
                            c.connection?.connected_account?.status ===
                              'ACTIVE'),
                      );
                      return (
                        <div className="public-connection" key={slug}>
                          <AppIcon slug={slug} />
                          <span>{appDefinition(slug)?.name ?? slug}</span>
                          {connected ? (
                            <span className="connection-connected">
                              <Check size={13} />
                              Connected
                            </span>
                          ) : !signedIn ? (
                            <a href={signInUrl}>Connect</a>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => void connect(slug)}
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {connections?.connectionError && (
                      <p role="alert">
                        Could not verify connections. Refresh to try again.
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!signedIn || busy}
                      onClick={() => void refreshConnections()}
                    >
                      Refresh connections
                    </Button>
                  </>
                )}
              </section>
              <section className="public-card hosted-input">
                <h2>Run workflow</h2>
                <label htmlFor="public-input">Your input</label>
                <Textarea
                  id="public-input"
                  value={run?.input ?? input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={12000}
                  rows={6}
                  disabled={Boolean(run) || busy}
                  placeholder="What would you like to process? Add instructions or upload a document."
                />
                {!run && (
                  <DocumentInput
                    documents={documents}
                    onChange={setDocuments}
                    onLoading={setExtracting}
                    disabled={busy}
                  />
                )}
                {!run ? (
                  !signedIn ? (
                    <a className="public-signin" href={signInUrl}>
                      Sign in to run
                    </a>
                  ) : (
                    <>
                      <Button
                        className="hosted-run-button"
                        disabled={
                          busy ||
                          extracting ||
                          !ready ||
                          (!snapshot && !info.available) ||
                          (!input.trim() && !documents.length)
                        }
                        onClick={() => void beginRun()}
                      >
                        {busy ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : (
                          <Play size={15} />
                        )}{' '}
                        {busy ? 'Starting…' : 'Run workflow'}
                      </Button>
                      {!snapshot && !info.available && (
                        <p>
                          This link has reached its run limit. Ask the owner for
                          a new link.
                        </p>
                      )}
                      {!ready && (
                        <p>Connect the apps above to run this workflow.</p>
                      )}
                    </>
                  )
                ) : (
                  <>
                    <div className="hosted-status">
                      <strong>{run.status.replaceAll('_', ' ')}</strong>
                      <span>
                        {run.usage.costUsd === null
                          ? ''
                          : `$${run.usage.costUsd.toFixed(4)}`}
                      </span>
                    </div>
                    {run.error && <p role="alert">{run.error}</p>}
                    {['running', 'paused', 'awaiting_approval'].includes(
                      run.status,
                    ) && (
                      <div className="public-controls">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              run.status === 'paused' ? 'resume' : 'pause',
                            )
                          }
                        >
                          {run.status === 'paused' ? 'Continue' : 'Pause'}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void act('pause', { stop: true })}
                        >
                          Stop
                        </Button>
                      </div>
                    )}
                    {!auto && run.status === 'running' && (
                      <Button disabled={busy} onClick={() => setAuto(true)}>
                        Retry next step
                      </Button>
                    )}
                    {!['running', 'paused', 'awaiting_approval'].includes(
                      run.status,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setSnapshot(null);
                          setInput('');
                          setDocuments([]);
                          window.history.replaceState(null, '', `/w/${id}`);
                          void request<PublicInfo>(`/api/workflows/${id}`)
                            .then(setInfo)
                            .catch((e) => setError(e.message));
                        }}
                      >
                        Run again
                      </Button>
                    )}
                  </>
                )}
              </section>
              {run?.pending && (
                <ActionReview run={run} busy={busy} onAction={act} />
              )}
              {attempt && (
                <section className="public-card hosted-result">
                  <h2>
                    {run?.status === 'completed' ? 'Result' : 'Run progress'}
                  </h2>
                  {!final?.output && (
                    <ol>
                      {attempt.states.map((state) => (
                        <li key={state.nodeId}>
                          {
                            attempt.workflow.nodes.find(
                              (n) => n.id === state.nodeId,
                            )?.name
                          }{' '}
                          — {state.status}
                          {state.error && <p>{state.error}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {final?.output && (
                    <div className="markdown-body">
                      <ReactMarkdown>{final.output}</ReactMarkdown>
                    </div>
                  )}
                  {attempt.evaluation ? (
                    <p>
                      {attempt.evaluation.summary} ·{' '}
                      {Math.round(attempt.evaluation.score * 100)}%
                    </p>
                  ) : (
                    run?.status === 'completed' && (
                      <p className="quiet-text">
                        Review this result before using it. This run hasn’t been
                        independently verified.
                      </p>
                    )
                  )}
                </section>
              )}
            </div>
            <section
              className="hosted-architecture"
              aria-label="Agent architecture"
            >
              <div className="hosted-architecture-header">
                <GitBranch size={17} />
                <h2>Agent architecture</h2>
                <span>
                  {info.steps.length}{' '}
                  {info.steps.length === 1 ? 'agent' : 'agents'}
                </span>
              </div>
              {architecture && (
                <WorkflowCanvas
                  workflow={architecture}
                  attempt={attempt}
                  onSelect={() => {}}
                />
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
