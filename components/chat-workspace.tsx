'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  LoaderCircle,
  MemoryStick,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Plug,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import WorkflowCanvas from './workflow-canvas';
import AppPicker, { AppIcon } from './app-picker';
import RunConversation from './run-conversation';
import { APP_CATALOG } from '@/lib/workbench/apps';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { Switch } from './ui/switch';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './ui/resizable';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar';
import type { AgentNode, Chat, Run, Observation } from '@/lib/workbench/types';
type Snapshot = { chat: Omit<Chat, 'sessionId'>; runs: Run[] };
type ChatRow = { id: string; title: string; updated_at: string };
type Integrations = {
  model: string;
  gemini: boolean;
  composio: boolean;
  langsmith: boolean;
  pricing: boolean;
  connectionError: string | null;
  connections: {
    slug: string;
    name: string;
    connection?: {
      is_active?: boolean;
      isActive?: boolean;
      connected_account?: { status: string };
    };
  }[];
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r
    .json()
    .catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok)
    throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data as T;
}
const percent = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number | null) =>
  x === null ? 'Unpriced' : `$${x.toFixed(4)}`;
const examples = [
  {
    icon: FileText,
    title: 'Turn a document into a deck',
    description: 'Read, structure, design, and verify.',
    prompt:
      'Build agents that turn a Google Doc into an executive PowerPoint deck. Ask for my document URL in the workflow instructions, read the actual source, create slides, and export a real PPTX. Verify facts and the export before delivering.',
  },
  {
    icon: Layers3,
    title: 'Build my editorial team',
    description: 'Research, draft, and fact-check a blog.',
    prompt:
      'Build a blog production workflow: research from my Google Docs, draft a clear article, check every factual claim against source evidence, and prepare a final Google Doc for my review. The topic and source URLs will follow.',
  },
  {
    icon: GitBranch,
    title: 'Make sense of project activity',
    description: 'Connect issues, context, and decisions.',
    prompt:
      'Build agents that read GitHub project issues and pull requests, identify release blockers and their owners, and prepare a source-linked weekly status report. I will provide the repository.',
  },
];
function TraceItem({ trace }: { trace: Observation }) {
  return (
    <details className={`wb-trace ${trace.error ? 'has-error' : ''}`}>
      <summary>
        <span className="trace-kind">{trace.kind}</span>
        <strong>{trace.name}</strong>
        <span>{(trace.durationMs / 1000).toFixed(1)}s</span>
        <ChevronRight size={13} />
      </summary>
      <div className="trace-body">
        <small>Observation {trace.id}</small>
        <p>Input</p>
        <pre>{trace.input}</pre>
        <p>Output</p>
        <pre>{trace.output || trace.error}</pre>
        <small>
          {trace.usage.inputTokens + trace.usage.outputTokens} tokens ·
          LangSmith {trace.langsmith}
        </small>
      </div>
    </details>
  );
}
function TaskButton({
  onClick,
  ...props
}: React.ComponentProps<typeof SidebarMenuButton>) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(event) => {
        setOpenMobile(false);
        onClick?.(event);
      }}
    />
  );
}
function rememberTask(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('task', id);
  else url.searchParams.delete('task');
  window.history.replaceState(null, '', url);
}
function TaskActionButton({
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpenMobile } = useSidebar();
  return (
    <Button
      {...props}
      onClick={(event) => {
        setOpenMobile(false);
        onClick?.(event);
      }}
    />
  );
}
export default function ChatWorkspace() {
  const [rows, setRows] = useState<ChatRow[]>([]),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [integrations, setIntegrations] = useState<Integrations | null>(null),
    [tab, setTab] = useState('workflow'),
    [selectedNode, setSelectedNode] = useState<AgentNode | null>(null),
    [instruction, setInstruction] = useState(''),
    [selectedRunId, setSelectedRunId] = useState(''),
    [attemptIndex, setAttemptIndex] = useState(-1),
    [auto, setAuto] = useState(false),
    [useMemory, setUseMemory] = useState(true),
    [limitsOpen, setLimitsOpen] = useState(false),
    [limitTarget, setLimitTarget] = useState(85),
    [limitAttempts, setLimitAttempts] = useState(3),
    [limitTools, setLimitTools] = useState(16),
    [selectedApps, setSelectedApps] = useState<string[]>([]),
    [mobileView, setMobileView] = useState('chat'),
    [showCanvas, setShowCanvas] = useState(true);
  const [reconciliation, setReconciliation] = useState('');
  const mounted = useRef(true),
    inFlight = useRef(false),
    selectedId = useRef<string | null>(null),
    scrollEnd = useRef<HTMLDivElement>(null);
  const chat = snapshot?.chat;
  const run =
    snapshot?.runs.find((r) => r.id === selectedRunId) ?? snapshot?.runs[0];
  const activeRun = snapshot?.runs.find((r) =>
    ['running', 'paused', 'awaiting_approval'].includes(r.status),
  );
  const attempt =
    run?.attempts[
      attemptIndex < 0
        ? run.attempts.length - 1
        : Math.min(attemptIndex, run.attempts.length - 1)
    ];
  const workflow =
    tab === 'runs' && attempt
      ? attempt.workflow
      : chat?.versions.at(-1)?.workflow;
  const liveAttempt =
    attempt && JSON.stringify(attempt.workflow) === JSON.stringify(workflow)
      ? attempt
      : undefined;
  const refreshRows = useCallback(async () => {
    const r = await api<{ chats: ChatRow[] }>('/api/chats');
    if (mounted.current) setRows(r.chats);
  }, []);
  const refreshIntegrations = useCallback(async () => {
    const r = await api<Integrations>('/api/integrations');
    if (mounted.current) setIntegrations(r);
  }, []);
  const openChat = useCallback(async (id: string) => {
    if (inFlight.current) return;
    setAuto(false);
    selectedId.current = id;
    setBusy(true);
    setError('');
    try {
      const data = await api<Snapshot>(`/api/chats/${id}`);
      if (selectedId.current === id) {
        setSnapshot(data);
        rememberTask(data.chat.id);
        setSelectedApps(data.chat.selectedApps ?? []);
        setMobileView('chat');
        setSelectedRunId('');
        setAttemptIndex(-1);
        setShowCanvas(true);
        setDraft('');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void Promise.allSettled([refreshRows(), refreshIntegrations()]).then(
      (results) => {
        for (const r of results)
          if (r.status === 'rejected') setError(r.reason.message);
      },
    );
    const showSettings = () => setSettingsOpen(true);
    if (new URLSearchParams(location.search).has('settings'))
      queueMicrotask(showSettings);
    const taskId = new URLSearchParams(location.search).get('task');
    if (taskId && /^[a-zA-Z0-9-]{1,80}$/.test(taskId))
      queueMicrotask(() => void openChat(taskId));
    return () => {
      mounted.current = false;
    };
  }, [refreshRows, refreshIntegrations, openChat]);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional WebMCP support. */
      }
    };
    register({
      name: 'list_foundry_tasks',
      description: 'Read the current authenticated workspace task list.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => api('/api/chats'),
    });
    register({
      name: 'inspect_foundry_task',
      description:
        'Read an existing task workflow, run evidence, and scoped memory. Does not execute agents or external actions.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input: unknown) => {
        const id = (input as { id?: unknown })?.id;
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
          throw new Error('Valid task ID required');
        return api(`/api/chats/${id}`);
      },
    });
    return () => lifecycle.abort();
  }, []);
  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length, busy]);
  const accept = (data: Snapshot) => {
    if (selectedId.current === data.chat.id) {
      setSnapshot(data);
      void refreshRows().catch(() => {});
    }
  };
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!chat || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await api<Snapshot>(`/api/chats/${chat.id}/${action}`, {
        revision: chat.revision,
        runId: run?.id,
        ...extra,
      });
      accept(data);
      return data;
    } catch (e) {
      setError((e as Error).message);
      setAuto(false);
      const fresh = await api<Snapshot>(`/api/chats/${chat.id}`).catch(
        () => null,
      );
      if (fresh) accept(fresh);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function send() {
    if (!draft.trim() || busy || activeRun) return;
    const message = draft.trim();
    if (chat) {
      const result = await act('message', { message, selectedApps });
      if (result) {
        setDraft('');
        setSelectedRunId('');
        setShowCanvas(true);
        setTab('workflow');
      }
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api<Snapshot>('/api/chats', { message, selectedApps });
      selectedId.current = data.chat.id;
      rememberTask(data.chat.id);
      setSnapshot(data);
      setDraft('');
      setShowCanvas(true);
      void refreshRows();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!auto || busy || run?.status !== 'running' || inFlight.current) return;
    const timer = setTimeout(() => void act('advance'), 250);
    return () => clearTimeout(timer);
  });
  async function beginRun() {
    const data = await act('run', { useMemory });
    if (data) {
      setSelectedRunId(data.runs[0]?.id ?? '');
      setAttemptIndex(-1);
      setAuto(true);
      setTab('workflow');
    }
  }
  async function connect(slug: string) {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ url: string }>('/api/integrations/connect', {
        toolkit: slug,
      });
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const openNode = (node: AgentNode) => {
    setSelectedNode(node);
    setInstruction(node.instruction);
  };
  const newChat = () => {
    if (busy) return;
    selectedId.current = null;
    rememberTask(null);
    setSnapshot(null);
    setSelectedApps([]);
    setMobileView('chat');
    setDraft('');
    setAuto(false);
    setSelectedRunId('');
    setError('');
  };
  const composer = (
    <form
      className="wb-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={
          chat
            ? 'Refine the task, add context, or change an agent…'
            : 'What would you like your agents to do?'
        }
        aria-label="Task or workflow modification"
        maxLength={12000}
        rows={2}
      />
      <div className="composer-footer">
        <AppPicker
          value={selectedApps}
          onChange={setSelectedApps}
          disabled={busy || Boolean(activeRun)}
          onConnections={() => setSettingsOpen(true)}
          connected={integrations?.connections
            .filter(
              (c) =>
                c.connection?.is_active ||
                c.connection?.isActive ||
                c.connection?.connected_account?.status === 'ACTIVE',
            )
            .map((c) => c.slug)}
        />
        <span className="model-label">
          {integrations?.model ?? 'gemini-3.8-flash'}
        </span>
        <Button
          className="send-button"
          size="icon"
          type="submit"
          disabled={busy || !draft.trim() || Boolean(activeRun)}
          aria-label="Send task"
        >
          {busy ? <LoaderCircle className="spin" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
  );
  return (
    <SidebarProvider
      className="wb-shell"
      style={{ '--sidebar-width': '245px' } as React.CSSProperties}
    >
      <Sidebar className="wb-sidebar">
        <SidebarHeader>
          <button className="wb-brand" onClick={newChat}>
            <span className="brand-mark">
              <GitBranch size={20} />
            </span>
            <span>
              foundry<span className="brand-dot">.</span>
            </span>
            <span className="preview-label">LAB</span>
          </button>
          <TaskActionButton
            className="new-chat"
            variant="outline"
            onClick={newChat}
            disabled={busy}
          >
            <Plus size={16} />
            New task<span>+</span>
          </TaskActionButton>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Your workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <TaskButton onClick={newChat} isActive={!chat}>
                  <MessageSquare />
                  <span>Agent studio</span>
                </TaskButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <TaskButton onClick={() => setSettingsOpen(true)}>
                  <Plug />
                  <span>Connections</span>
                </TaskButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="chat-list">
            <SidebarGroupLabel>
              Recent tasks <span>{rows.length}</span>
            </SidebarGroupLabel>
            <SidebarMenu>
              {rows.map((row) => (
                <SidebarMenuItem key={row.id}>
                  <TaskButton
                    onClick={() => void openChat(row.id)}
                    isActive={chat?.id === row.id}
                    disabled={busy}
                    title={row.title}
                  >
                    <MessageSquare size={14} />
                    <span>{row.title}</span>
                  </TaskButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {!rows.length && (
              <p className="sidebar-empty">
                Your agents start with a conversation.
              </p>
            )}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="workspace-note">
            <ShieldCheck size={15} />
            <div>
              Private workspace<small>Memory stays within each task</small>
            </div>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <TaskButton
                onClick={() => {
                  setSettingsOpen(true);
                  void refreshIntegrations();
                }}
              >
                <Settings2 />
                <span>Settings & integrations</span>
              </TaskButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Link className="lab-link" href="/lab">
            <FlaskConical size={13} />
            Evaluation lab
            <ArrowUpRight size={12} />
          </Link>
        </SidebarFooter>
      </Sidebar>
      <main className="wb-main">
        <header className="wb-header">
          <SidebarTrigger />
          <span className="header-breadcrumb">Agent studio</span>
          {chat && (
            <>
              <ChevronRight size={13} />
              <strong>{chat.title}</strong>
            </>
          )}
          <div className="header-right">
            <span className="connection-indicator">
              <i className={integrations?.gemini ? 'connected' : ''} />
              {integrations?.gemini ? 'Model connected' : 'Model setup needed'}
            </span>
            {chat && (
              <Button
                variant="ghost"
                size="sm"
                className="desktop-workflow-toggle"
                onClick={() => setShowCanvas(!showCanvas)}
              >
                <GitBranch size={14} />
                {showCanvas ? 'Hide workflow' : 'Show workflow'}
              </Button>
            )}
          </div>
        </header>
        {chat && (
          <nav className="mobile-view-switch" aria-label="Workspace view">
            <button
              aria-pressed={mobileView === 'chat'}
              onClick={() => setMobileView('chat')}
            >
              <MessageSquare size={14} />
              Chat
            </button>
            <button
              aria-pressed={mobileView === 'workflow'}
              onClick={() => {
                setShowCanvas(true);
                setMobileView('workflow');
              }}
            >
              <GitBranch size={14} />
              Workflow <span>{workflow?.nodes.length}</span>
            </button>
          </nav>
        )}
        {error && (
          <div role="alert" className="wb-error">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss error">
              <X size={15} />
            </button>
          </div>
        )}
        {!chat ? (
          <div className="wb-home">
            <div className="home-intro">
              <h1>What are we working on?</h1>
              <p>
                Describe a task. We’ll build the workflow, test its output,
                <br className="desktop-break" /> and work through improvements
                here with you.
              </p>
            </div>
            <div className="home-compose">{composer}</div>
            <div className="starter-grid">
              {examples.map(({ icon: Icon, ...e }) => (
                <button key={e.title} onClick={() => setDraft(e.prompt)}>
                  <Icon size={19} />
                  <strong>{e.title}</strong>
                  <p>{e.description}</p>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className={`wb-panels mobile-${mobileView} ${showCanvas ? '' : 'canvas-hidden'}`}
          >
            <ResizablePanel
              defaultSize={showCanvas ? '60%' : '100%'}
              minSize="320px"
            >
              <section className="conversation">
                <div className="chat-messages">
                  {chat.messages.map((m) =>
                    m.kind ? (
                      <RunConversation
                        key={m.id}
                        message={m}
                        run={snapshot.runs.find((r) => r.id === m.runId)}
                      />
                    ) : (
                      <article key={m.id} className={`wb-message ${m.role}`}>
                        <div className="message-avatar">
                          {m.role === 'assistant' ? (
                            <GitBranch size={15} />
                          ) : (
                            <span>Y</span>
                          )}
                        </div>
                        <div className="message-content">
                          <small>
                            {m.role === 'assistant' ? 'Foundry' : 'You'}
                          </small>
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      </article>
                    ),
                  )}
                  {busy && (
                    <div className="working-message">
                      <LoaderCircle size={14} className="spin" />
                      {run?.status === 'running'
                        ? `Working · ${run.phase}`
                        : 'Updating your workspace…'}
                    </div>
                  )}
                  {run && (
                    <div className="run-chat-card">
                      <div>
                        <span className={`status-orb ${run.status}`} />
                        <strong>
                          {run.status === 'completed'
                            ? 'Run complete'
                            : run.status.replaceAll('_', ' ')}
                        </strong>
                        <span>
                          Attempt {run.attempts.length} / {run.maxIterations}
                        </span>
                      </div>
                      <p>
                        {run.error ??
                          (run.status === 'running'
                            ? auto
                              ? 'Executing agents and checking their outputs.'
                              : 'Progress is saved. Continue to execute the next step.'
                            : 'Review the results above. Tell me what to improve, or test the workflow again.')}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTab('runs');
                          setShowCanvas(true);
                          setMobileView('workflow');
                        }}
                      >
                        View run evidence
                        <ArrowUpRight size={12} />
                      </Button>
                    </div>
                  )}
                  {run?.pending &&
                    ['awaiting_approval', 'executing', 'unknown'].includes(
                      run.pending.status,
                    ) && (
                      <div className="action-review">
                        <div>
                          <ShieldCheck size={17} />
                          <strong>Review external action</strong>
                        </div>
                        <p>{run.pending.description}</p>
                        <code>{run.pending.tool.slug}</code>
                        <details>
                          <summary>View exact arguments</summary>
                          <pre>
                            {JSON.stringify(run.pending.arguments, null, 2)}
                          </pre>
                        </details>
                        {run.pending.status !== 'awaiting_approval' && (
                          <div className="reconcile-form">
                            <label htmlFor="wb-field-1" className="field-label">
                              Verify the outcome in the connected app
                              <Textarea
                                id="wb-field-1"
                                value={reconciliation}
                                onChange={(e) =>
                                  setReconciliation(e.target.value)
                                }
                                placeholder="What happened? Include the resource link or result you checked."
                                maxLength={3000}
                              />
                            </label>
                            <Button
                              size="sm"
                              disabled={
                                busy || reconciliation.trim().length < 10
                              }
                              onClick={() =>
                                void act('reconcile', {
                                  pendingId: run.pending?.id,
                                  note: reconciliation,
                                }).then((data) => {
                                  if (data) setReconciliation('');
                                })
                              }
                            >
                              Record verified outcome & stop
                            </Button>
                          </div>
                        )}
                        <footer>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              busy || run.pending.status !== 'awaiting_approval'
                            }
                            onClick={() => void act('reject')}
                          >
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            disabled={
                              busy || run.pending.status !== 'awaiting_approval'
                            }
                            onClick={() =>
                              void act('approve', {
                                pendingId: run.pending?.id,
                              }).then((data) => {
                                if (data) setAuto(true);
                              })
                            }
                          >
                            Approve & execute
                          </Button>
                        </footer>
                        {run.pending.status === 'executing' && (
                          <p>
                            Dispatch was checkpointed. Reconcile in the app if
                            the response was interrupted; it will not
                            automatically replay.
                          </p>
                        )}
                      </div>
                    )}
                  <div ref={scrollEnd} />
                </div>
                <div className="chat-bottom">
                  <div className="chat-test-controls">
                    <span>
                      {activeRun
                        ? `Attempt ${activeRun.attempts.length} of ${activeRun.maxIterations}`
                        : `${workflow?.nodes.length ?? 0} agents · target ${percent(chat.settings.target)}`}
                    </span>
                    {activeRun ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            if (activeRun.status === 'paused')
                              void act('resume', { runId: activeRun.id }).then(
                                () => setAuto(true),
                              );
                            else if (!auto) setAuto(true);
                            else {
                              setAuto(false);
                              void act('pause', { runId: activeRun.id });
                            }
                          }}
                        >
                          {auto ? 'Pause test' : 'Continue test'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setAuto(false);
                            void act('pause', {
                              stop: true,
                              runId: activeRun.id,
                            });
                          }}
                        >
                          Stop & edit
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void beginRun()}
                      >
                        <FlaskConical size={14} />
                        {run ? 'Test again' : 'Test workflow'}
                      </Button>
                    )}
                  </div>
                  {activeRun && (
                    <div className="active-hint">
                      {busy
                        ? 'Current step is running.'
                        : 'Finish or stop this run to modify the workflow.'}
                    </div>
                  )}
                  {composer}
                  <p>
                    Changes create a new workflow version. Previous runs keep
                    their original evidence.
                  </p>
                </div>
              </section>
            </ResizablePanel>
            {showCanvas && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="40%" minSize="360px">
                  <section className="workflow-panel">
                    <div className="workflow-header">
                      <span className="workflow-icon">
                        <GitBranch size={16} />
                      </span>
                      <div>
                        <strong>Agent workflow</strong>
                        <small>
                          {workflow?.nodes.length ?? 0} agents · version{' '}
                          {chat.versions.length}
                        </small>
                      </div>
                      <div className="workflow-actions">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Run limits"
                          onClick={() => {
                            setLimitTarget(
                              Math.round(chat.settings.target * 100),
                            );
                            setLimitAttempts(chat.settings.maxIterations);
                            setLimitTools(chat.settings.maxToolCalls);
                            setLimitsOpen(true);
                          }}
                        >
                          <Settings2 size={15} />
                        </Button>
                        {activeRun ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                if (run?.status === 'paused')
                                  void act('resume').then(() => setAuto(true));
                                else if (run?.status === 'running' && !auto)
                                  setAuto(true);
                                else {
                                  setAuto(false);
                                  void act('pause');
                                }
                              }}
                            >
                              {run?.status === 'paused' || !auto ? (
                                <Play size={12} />
                              ) : (
                                <Pause size={12} />
                              )}{' '}
                              {run?.status === 'paused' || !auto
                                ? 'Continue'
                                : 'Pause'}
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={busy}
                              aria-label="Stop run"
                              onClick={() => {
                                setAuto(false);
                                void act('pause', {
                                  stop: true,
                                  runId: activeRun.id,
                                });
                              }}
                            >
                              <Square size={12} />
                            </Button>
                          </>
                        ) : (
                          <Button
                            className="run-button"
                            size="sm"
                            disabled={busy}
                            onClick={() => void beginRun()}
                          >
                            <Play size={12} />
                            Test workflow
                          </Button>
                        )}
                      </div>
                    </div>
                    <Tabs
                      value={tab}
                      onValueChange={(v) => setTab(String(v))}
                      className="workspace-tabs"
                    >
                      <div className="workspace-tabbar">
                        <TabsList variant="line">
                          <TabsTrigger value="workflow">
                            <GitBranch size={13} />
                            Workflow
                          </TabsTrigger>
                          <TabsTrigger value="memory">
                            <MemoryStick size={13} />
                            Memory<span>{chat.memory.length}</span>
                          </TabsTrigger>
                          <TabsTrigger value="runs">
                            <Clock3 size={13} />
                            Runs<span>{snapshot.runs.length}</span>
                          </TabsTrigger>
                        </TabsList>
                        <span className="saved-label">
                          <Check size={11} />
                          Saved
                        </span>
                      </div>
                      <TabsContent value="workflow" className="canvas-tab">
                        {workflow && (
                          <WorkflowCanvas
                            key={chat.id}
                            workflow={workflow}
                            attempt={liveAttempt}
                            onSelect={openNode}
                          />
                        )}
                        <div className="canvas-legend">
                          <span>
                            <i />
                            Agent
                          </span>
                          <span>Click to inspect · drag to arrange</span>
                        </div>
                        <div className="quality-strip">
                          <div>
                            <small>Rubric score</small>
                            <strong>
                              {liveAttempt?.evaluation
                                ? percent(liveAttempt.evaluation.score)
                                : '—'}
                            </strong>
                          </div>
                          <div>
                            <small>Target</small>
                            <strong>
                              {percent(
                                liveAttempt && run
                                  ? run.target
                                  : chat.settings.target,
                              )}
                            </strong>
                          </div>
                          <div>
                            <small>Tokens</small>
                            <strong>
                              {liveAttempt && run
                                ? (
                                    run.usage.inputTokens +
                                    run.usage.outputTokens
                                  ).toLocaleString()
                                : '—'}
                            </strong>
                          </div>
                          <div>
                            <small>Estimated cost</small>
                            <strong>
                              {liveAttempt && run
                                ? money(run.usage.costUsd)
                                : '—'}
                            </strong>
                          </div>
                        </div>
                        <p className="score-note">
                          {liveAttempt
                            ? 'Rubric score from this version’s test. Open Runs for evidence.'
                            : 'This workflow version hasn’t been tested yet. Results will appear in chat.'}
                        </p>
                      </TabsContent>
                      <TabsContent value="memory" className="detail-tab">
                        <div className="section-intro">
                          <span className="eyebrow">LEARNED IN THIS TASK</span>
                          <h2>Task memory</h2>
                          <p>
                            Reflections become proposed lessons. Evidence from
                            later runs can support or contradict them.
                          </p>
                        </div>
                        {!chat.memory.length ? (
                          <div className="wb-empty">
                            <MemoryStick size={28} />
                            <strong>No lessons yet</strong>
                            <p>
                              Run this workflow to build memory from actual
                              execution evidence.
                            </p>
                          </div>
                        ) : (
                          chat.memory.map((m) => (
                            <article className="memory-card" key={m.id}>
                              <div>
                                <span>{m.kind.replace('_', ' ')}</span>
                                <span className={`memory-status ${m.status}`}>
                                  {m.status.replace('_', ' ')}
                                </span>
                              </div>
                              <p>{m.content}</p>
                              <small>
                                {m.evidence.length} evidence links · used{' '}
                                {m.usedCount} times · supported in{' '}
                                {m.supportedRuns.length} later runs
                              </small>
                              <details>
                                <summary>Source evidence</summary>
                                {m.evidence.map((id) => (
                                  <code key={id}>{id}</code>
                                ))}
                                <span>Run {m.sourceRun}</span>
                              </details>
                              <div className="memory-actions">
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  disabled={
                                    busy ||
                                    Boolean(activeRun) ||
                                    m.status === 'user_confirmed'
                                  }
                                  onClick={() =>
                                    void act('memory', {
                                      memoryId: m.id,
                                      operation: 'confirm',
                                    })
                                  }
                                >
                                  <Check size={12} />
                                  Confirm
                                </Button>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  disabled={busy || Boolean(activeRun)}
                                  onClick={() =>
                                    void act('memory', {
                                      memoryId: m.id,
                                      operation: 'reject',
                                    })
                                  }
                                >
                                  Reject
                                </Button>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  disabled={busy || Boolean(activeRun)}
                                  aria-label="Delete memory"
                                  onClick={() =>
                                    void act('memory', {
                                      memoryId: m.id,
                                      operation: 'delete',
                                    })
                                  }
                                >
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            </article>
                          ))
                        )}
                      </TabsContent>
                      <TabsContent value="runs" className="detail-tab">
                        <div className="section-intro">
                          <span className="eyebrow">EXECUTION & EVIDENCE</span>
                          <h2>Run history</h2>
                          <p>
                            Compare attempts, inspect tool responses, and see
                            what the next run learned.
                          </p>
                        </div>
                        {!run ? (
                          <div className="wb-empty">
                            <Play size={28} />
                            <strong>Ready when you are</strong>
                            <p>Run the architecture to measure its outputs.</p>
                          </div>
                        ) : (
                          <>
                            <div className="run-selectors">
                              <NativeSelect
                                aria-label="Choose run"
                                disabled={Boolean(activeRun)}
                                value={run.id}
                                onChange={(e) => {
                                  setSelectedRunId(e.target.value);
                                  setAttemptIndex(-1);
                                  setAuto(false);
                                }}
                              >
                                {snapshot.runs.map((r, i) => (
                                  <NativeSelectOption key={r.id} value={r.id}>
                                    Run {snapshot.runs.length - i} ·{' '}
                                    {r.status.replaceAll('_', ' ')}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              <NativeSelect
                                aria-label="Choose attempt"
                                value={attempt?.iteration ?? 1}
                                onChange={(e) =>
                                  setAttemptIndex(Number(e.target.value) - 1)
                                }
                              >
                                {run.attempts.map((a) => (
                                  <NativeSelectOption
                                    key={a.id}
                                    value={a.iteration}
                                  >
                                    Attempt {a.iteration}
                                    {a.evaluation
                                      ? ` · ${percent(a.evaluation.score)}`
                                      : ''}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </div>
                            <div className="run-facts">
                              <span>
                                <strong>
                                  {(
                                    run.usage.inputTokens +
                                    run.usage.outputTokens
                                  ).toLocaleString()}
                                </strong>
                                tokens
                              </span>
                              <span>
                                <strong>{money(run.usage.costUsd)}</strong>model
                                cost
                              </span>
                              <span>
                                <strong>
                                  {(
                                    (attempt?.traces.reduce(
                                      (n, t) => n + t.durationMs,
                                      0,
                                    ) ?? 0) / 1000
                                  ).toFixed(1)}
                                  s
                                </strong>
                                attempt step time
                              </span>
                              <span>
                                <strong>{run.useMemory ? 'On' : 'Off'}</strong>
                                memory
                              </span>
                            </div>
                            {attempt?.evaluation && (
                              <div className="evaluation-card">
                                <header>
                                  <strong>Frozen rubric</strong>
                                  <span
                                    className={
                                      attempt.evaluation.verdict === 'pass'
                                        ? 'pass'
                                        : 'needs-work'
                                    }
                                  >
                                    {percent(attempt.evaluation.score)} ·{' '}
                                    {attempt.evaluation.verdict}
                                  </span>
                                </header>
                                <p>{attempt.evaluation.summary}</p>
                                {run.rubric.map((c) => {
                                  const check = attempt.evaluation?.checks.find(
                                    (k) => k.criterionId === c.id,
                                  );
                                  return (
                                    <details
                                      key={c.id}
                                      className="rubric-check"
                                    >
                                      <summary>
                                        <span>
                                          {c.name}
                                          {c.required && (
                                            <small>Required</small>
                                          )}
                                        </span>
                                        <strong>
                                          {percent(check?.score ?? 0)}
                                        </strong>
                                      </summary>
                                      <p>{c.description}</p>
                                      <p>{check?.rationale}</p>
                                      <small>
                                        {check?.verified
                                          ? 'Evidence references checked'
                                          : 'Missing evidence'}{' '}
                                        · weight {c.weight}
                                      </small>
                                      {check?.evidenceIds.map((id) => (
                                        <code key={id}>{id}</code>
                                      ))}
                                    </details>
                                  );
                                })}
                                {attempt.evaluation.issues.map((i, n) => (
                                  <p className="evaluation-issue" key={n}>
                                    {i}
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="trace-list-title">
                              Step log{' '}
                              <span>
                                {attempt?.traces.length ?? 0} observations
                              </span>
                            </div>
                            {attempt?.traces.map((t) => (
                              <TraceItem key={t.id} trace={t} />
                            ))}
                            {!attempt?.traces.length && (
                              <p className="quiet-text">
                                No completed steps yet.
                              </p>
                            )}
                          </>
                        )}
                      </TabsContent>
                    </Tabs>
                  </section>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </main>
      <Dialog
        open={Boolean(selectedNode)}
        onOpenChange={(open) => {
          if (!open) setSelectedNode(null);
        }}
      >
        <DialogContent className="wb-dialog agent-dialog">
          <DialogHeader>
            <DialogTitle>{selectedNode?.name}</DialogTitle>
            <DialogDescription>
              {selectedNode?.role} · Edit the instruction or inspect this
              agent’s last execution.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="wb-field-2" className="field-label">
            Agent instruction
            <Textarea
              id="wb-field-2"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={7}
              maxLength={4000}
            />
          </label>
          <div className="inspector-tools">
            <small>Assigned apps</small>
            <p>
              {selectedNode?.toolkits.join(' · ') ||
                'No external tools required'}
            </p>
          </div>
          {attempt?.states
            .find((s) => s.nodeId === selectedNode?.id)
            ?.tools.map((t) => (
              <details className="schema-detail" key={t.slug}>
                <summary>{t.slug}</summary>
                <p>{t.description}</p>
                <pre>{JSON.stringify(t.schema, null, 2)}</pre>
              </details>
            ))}
          {attempt?.states.find((s) => s.nodeId === selectedNode?.id)
            ?.output && (
            <details className="schema-detail">
              <summary>Last output</summary>
              <div className="message-content">
                <ReactMarkdown>
                  {
                    attempt.states.find((s) => s.nodeId === selectedNode?.id)!
                      .output
                  }
                </ReactMarkdown>
              </div>
            </details>
          )}
          <Button
            disabled={busy || Boolean(activeRun) || !instruction.trim()}
            onClick={() =>
              void act('node', { nodeId: selectedNode?.id, instruction }).then(
                (data) => {
                  if (data) setSelectedNode(null);
                },
              )
            }
          >
            Save new version
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={limitsOpen} onOpenChange={setLimitsOpen}>
        <DialogContent className="wb-dialog">
          <DialogHeader>
            <DialogTitle>Run controls</DialogTitle>
            <DialogDescription>
              These limits are frozen when a run starts.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="wb-field-3" className="field-label">
            Quality target (%)
            <Input
              id="wb-field-3"
              type="number"
              min={50}
              max={100}
              value={limitTarget}
              onChange={(e) => setLimitTarget(Number(e.target.value))}
            />
          </label>
          <label htmlFor="wb-field-4" className="field-label">
            Maximum attempts
            <Input
              id="wb-field-4"
              type="number"
              min={1}
              max={8}
              value={limitAttempts}
              onChange={(e) => setLimitAttempts(Number(e.target.value))}
            />
          </label>
          <label htmlFor="wb-field-5" className="field-label">
            Tool-call budget for the entire run
            <Input
              id="wb-field-5"
              type="number"
              min={1}
              max={60}
              value={limitTools}
              onChange={(e) => setLimitTools(Number(e.target.value))}
            />
          </label>
          <div className="run-rubric-preview">
            <strong>Evaluation criteria</strong>
            {chat?.versions.at(-1)?.workflow.criteria.map((c) => (
              <div key={c.id}>
                <span>
                  {c.name}
                  {c.required ? ' · required' : ''}
                </span>
                <p>{c.description}</p>
                <small>
                  {c.assertion?.kind && c.assertion.kind !== 'rubric'
                    ? 'Deterministic check'
                    : 'Model judgment'}
                </small>
              </div>
            ))}
          </div>
          <label htmlFor="wb-field-6" className="switch-label">
            <div>
              Use task memory
              <small>
                Switch off for a comparison run. The graph stays the same.
              </small>
            </div>
            <Switch
              id="wb-field-6"
              checked={useMemory}
              onCheckedChange={setUseMemory}
            />
          </label>
          <Button
            disabled={busy || Boolean(activeRun)}
            onClick={() =>
              void act('settings', {
                target: limitTarget / 100,
                maxIterations: limitAttempts,
                maxToolCalls: limitTools,
              }).then((data) => {
                if (data) setLimitsOpen(false);
              })
            }
          >
            Save controls
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="wb-dialog settings-dialog">
          <DialogHeader>
            <DialogTitle>Connections & settings</DialogTitle>
            <DialogDescription>
              Give your agents access to the tools you work in.
            </DialogDescription>
          </DialogHeader>
          <div className="provider-setting">
            <span className="provider-icon">
              <AudioLines size={22} />
            </span>
            <div>
              <strong>Gemini</strong>
              <small>{integrations?.model ?? 'gemini-3.8-flash'}</small>
            </div>
            <span
              className={
                integrations?.gemini ? 'provider-ready' : 'provider-missing'
              }
            >
              {integrations?.gemini ? 'Connected' : 'Not configured'}
            </span>
          </div>
          <div className="settings-section">
            <header>
              <strong>Apps through Composio</strong>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh connections"
                onClick={() =>
                  void refreshIntegrations().catch((e) => setError(e.message))
                }
              >
                <RotateCcw size={13} />
              </Button>
            </header>
            <p>
              Each account is scoped to you. Agents discover available actions
              when they run.
            </p>
            {!integrations?.composio && (
              <div className="setup-note">
                Composio isn’t configured for this workspace yet.
              </div>
            )}
            {integrations?.connectionError && (
              <p className="evaluation-issue">{integrations.connectionError}</p>
            )}
            <AppPicker
              value={selectedApps}
              onChange={setSelectedApps}
              disabled={busy || Boolean(activeRun)}
              onConnections={() => void refreshIntegrations()}
            />
            <div className="connection-list">
              {APP_CATALOG.filter(
                (app) =>
                  selectedApps.includes(app.slug) ||
                  integrations?.connections.some((c) => c.slug === app.slug),
              ).map((app) => {
                const c = integrations?.connections.find(
                  (c) => c.slug === app.slug,
                );
                const connected =
                  c?.connection?.is_active ||
                  c?.connection?.isActive ||
                  c?.connection?.connected_account?.status === 'ACTIVE';
                return (
                  <div key={app.slug}>
                    <AppIcon slug={app.slug} />
                    <span>
                      <strong>{app.name}</strong>
                      <small>
                        {connected ? 'Connected' : 'Account not connected'}
                      </small>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !integrations?.composio}
                      onClick={() => void connect(app.slug)}
                    >
                      {connected ? 'Reconnect' : 'Connect'}
                      <ArrowUpRight size={12} />
                    </Button>
                  </div>
                );
              })}
            </div>
            {!selectedApps.length && !integrations?.connections.length && (
              <p>Choose an app above to connect your account.</p>
            )}
          </div>
          <div className="settings-section">
            <header>
              <strong>Observability</strong>
              <span
                className={
                  integrations?.langsmith
                    ? 'provider-ready'
                    : 'provider-missing'
                }
              >
                {integrations?.langsmith
                  ? 'LangSmith configured'
                  : 'Local traces enabled'}
              </span>
            </header>
            <p>
              Tokens and durations come from actual calls. Dollar estimates
              require model pricing. App fees are separate.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
