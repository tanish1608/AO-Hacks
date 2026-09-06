'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  LoaderCircle,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  TrendingUp,
  X,
} from 'lucide-react';
import DocumentInput from './document-input';
import financeDemos from '@/lib/workbench/finance-demos.json';
import { combineRunInput, type InputDocument } from '@/lib/workbench/documents';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import WorkflowCanvas from './workflow-canvas';
import AppPicker, { AppIcon } from './app-picker';
import RunConversation from './run-conversation';
import TestResults from './test-results';
import { emptyUsage } from '@/lib/workbench/types';
import type { RunMetric, ToolKnowledgeRecord } from '@/lib/workbench/types';
import { ablation, learningTrend, median } from '@/lib/workbench/metrics';
import { MAX_PAIRS } from '@/lib/workbench/experiment';
import { PairedBars, TrendLine } from './learning-charts';
import { ALL_APPS, APP_CATALOG, appDefinition } from '@/lib/workbench/apps';
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
import type { AgentNode, Chat, Run } from '@/lib/workbench/types';
type Snapshot = {
  chat: Omit<Chat, 'sessionId'>;
  runs: Run[];
  metrics?: RunMetric[];
  knowledge?: ToolKnowledgeRecord[];
};
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
    apps: ['googledocs', 'googleslides', 'googledrive'],
    title: 'Turn a document into a deck',
    description: 'Read, structure, design, and verify.',
    prompt:
      'Build agents that turn a Google Doc into an executive PowerPoint deck. Ask for my document URL in the workflow instructions, read the actual source, create slides, and export a real PPTX. Verify facts and the export before delivering.',
  },
  {
    icon: Layers3,
    apps: ['googledocs', 'composio_search'],
    title: 'Build my editorial team',
    description: 'Research, draft, and fact-check a blog.',
    prompt:
      'Build a blog production workflow: research from my Google Docs, draft a clear article, check every factual claim against source evidence, and prepare a final Google Doc for my review. The topic and source URLs will follow.',
  },
  {
    icon: GitBranch,
    apps: ['github'],
    title: 'Make sense of project activity',
    description: 'Connect issues, context, and decisions.',
    prompt:
      'Build agents that read GitHub project issues and pull requests, identify release blockers and their owners, and prepare a source-linked weekly status report. I will provide the repository.',
  }
];
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
const appGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
  gap: 8,
  alignItems: 'stretch',
  width: '100%',
  minWidth: 0,
  maxHeight: '46dvh',
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: 1,
};
const appTileStyle: React.CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 8,
  width: '100%',
  minWidth: 0,
  minHeight: 88,
  padding: '13px 6px 10px',
  textAlign: 'center',
};
function rememberTask(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('task', id);
  else url.searchParams.delete('task');
  window.history.replaceState(null, '', url);
}
/** The connect redirect lands on ?settings=connections. Clear it once handled,
 *  or a refresh or a shared link keeps reopening Settings. */
function rememberSettings(open: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set('settings', 'connections');
  else url.searchParams.delete('settings');
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
    [auto, setAuto] = useState(false),
    [useMemory, setUseMemory] = useState(true),
    [limitsOpen, setLimitsOpen] = useState(false),
    [limitTarget, setLimitTarget] = useState(85),
    [limitAttempts, setLimitAttempts] = useState(3),
    [limitTools, setLimitTools] = useState(16),
    [selectedApps, setSelectedApps] = useState<string[]>([]),
    [mobileView, setMobileView] = useState('chat'),
    [showCanvas, setShowCanvas] = useState(true),
    [designing, setDesigning] = useState(false),
    [pendingMessage, setPendingMessage] = useState(''),
    [manualInput, setManualInput] = useState(''),
    [inputDocuments, setInputDocuments] = useState<InputDocument[]>([]),
    [readingDocument, setReadingDocument] = useState(false),
    [manualStarting, setManualStarting] = useState(false),
    [resultsId, setResultsId] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const [abInput, setAbInput] = useState('');
  const [abPairs, setAbPairs] = useState(2);
  const [allAppsOpen, setAllAppsOpen] = useState(false);
  const [appQuery, setAppQuery] = useState('');
  const [appLimit, setAppLimit] = useState(120);
  const mounted = useRef(true),
    inFlight = useRef(false),
    selectedId = useRef<string | null>(null),
    scrollEnd = useRef<HTMLDivElement>(null);
  const chat = snapshot?.chat;
  const activeRun = snapshot?.runs.find((r) =>
    ['running', 'paused', 'awaiting_approval'].includes(r.status),
  );
  const run =
    activeRun ??
    snapshot?.runs.find((r) => r.id === selectedRunId) ??
    snapshot?.runs[0];
  const testRuns = snapshot?.runs.filter((r) => r.mode !== 'manual') ?? [];
  const testRun = testRuns[0];
  const manualRuns = snapshot?.runs.filter((r) => r.mode === 'manual') ?? [];
  const manualRun = run?.mode === 'manual' ? run : manualRuns[0];
  const attempt = manualRun?.attempts.at(-1);
  const workflow = chat?.versions.at(-1)?.workflow;
  const requiredApps = [...new Set(workflow?.nodes.flatMap((n) => n.toolkits) ?? [])]
    .map(appDefinition).filter((a): a is NonNullable<typeof a> => Boolean(a && !a.noAuth));
  const missingApps = requiredApps.filter((a) => !integrations?.connections.some((c) =>
    c.slug === a.slug && (c.connection?.is_active || c.connection?.isActive || c.connection?.connected_account?.status === 'ACTIVE')));
  const waitingForConnections = requiredApps.length > 0 &&
    (!integrations || Boolean(integrations.connectionError) || missingApps.length > 0);
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
    setInputDocuments([]);
    setManualInput('');
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
        setAuto(
          data.runs.some((r) => r.mode !== 'manual' && r.status === 'running'),
        );
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
    const showSettings = () => {
      setSettingsOpen(true);
      rememberSettings(true);
    };
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
  }, [chat?.messages.length, busy, pendingMessage]);
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
    if (!draft.trim() || busy || activeRun || inFlight.current) return;
    const message = draft.trim();
    inFlight.current = true;
    setBusy(true);
    setDesigning(true);
    setPendingMessage(message);
    setDraft('');
    setError('');
    setMobileView('chat');
    let current = snapshot;
    try {
      const remembered =
        selectedId.current ?? new URLSearchParams(location.search).get('task');
      if (!current && remembered)
        current = await api<Snapshot>(`/api/chats/${remembered}`);
      if (!current) {
        setSnapshot({
          chat: {
            id: 'pending',
            title: message.slice(0, 70),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revision: 0,
            messages: [],
            versions: [],
            memory: [],
            settings: { target: 0.85, maxIterations: 3, maxToolCalls: 16 },
            modelUsage: emptyUsage(),
          },
          runs: [],
        });
        current = await api<Snapshot>('/api/chats', {
          message,
          selectedApps,
          initialize: true,
        });
      }
      selectedId.current = current.chat.id;
      rememberTask(current.chat.id);
      setSnapshot(current);
      const data = await api<Snapshot>(
        `/api/chats/${current.chat.id}/message`,
        {
          message,
          selectedApps,
          revision: current.chat.revision,
          autoTest: true,
        },
      );
      setSnapshot(data);
      setPendingMessage('');
      setSelectedRunId(data.runs[0]?.id ?? '');
      setAuto(true);
      setShowCanvas(true);
      setTab('workflow');
      void refreshRows();
    } catch (e) {
      setError((e as Error).message);
      setDraft(message);
      setPendingMessage('');
      setAuto(false);
      if (!current) {
        setSnapshot(null);
        selectedId.current = null;
        rememberTask(null);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      setDesigning(false);
    }
  }
  useEffect(() => {
    if (!auto || busy || run?.status !== 'running' || inFlight.current || waitingForConnections) return;
    const timer = setTimeout(() => void act('advance'), 250);
    return () => clearTimeout(timer);
  });
  // Featured, plus whatever this task selected and whatever is already
  // connected, so an app can never appear without a way to authorize it.
  const featuredApps = [
    ...new Set([
      ...APP_CATALOG.map((a) => a.slug),
      ...selectedApps,
      ...(integrations?.connections.map((c) => c.slug) ?? []),
    ]),
  ]
    .map((slug) => appDefinition(slug))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  const browsedApps = ALL_APPS.filter(
    (a) =>
      !appQuery ||
      (a.name + ' ' + a.slug + ' ' + a.description)
        .toLowerCase()
        .includes(appQuery.toLowerCase()),
  );
  const metrics = snapshot?.metrics ?? [];
  const knowledge = snapshot?.knowledge ?? [];
  const trend = learningTrend(metrics);
  const experiment = chat?.experiment;
  const armResult = experiment ? ablation(metrics, experiment.id) : null;
  const finishedArms =
    experiment?.arms.filter((a) => a.status === 'done' || a.status === 'failed')
      .length ?? 0;
  async function beginExperiment() {
    const data = await act('experiment', {
      operation: 'start',
      input: abInput,
      pairs: abPairs,
    });
    if (data) {
      setSelectedRunId(data.runs[0]?.id ?? '');
      setAuto(true);
    }
  }
  async function beginRun() {
    const data = await act('run', { useMemory, mode: 'test' });
    if (data) {
      setSelectedRunId(data.runs[0]?.id ?? '');
      setAuto(true);
    }
  }
  async function beginManual() {
    setManualStarting(true);
    try {
      const data = await act('run', {
        useMemory,
        mode: 'manual',
        input: combineRunInput(manualInput, inputDocuments),
      });
      if (data) {
        setSelectedRunId(data.runs[0]?.id ?? '');
        setAuto(true);
        setTab('manual');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare input');
    } finally {
      setManualStarting(false);
    }
  }
  async function connect(slug: string) {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ url: string }>('/api/integrations/connect', {
        toolkit: slug,
        chatId: chat?.id,
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
    setPendingMessage('');
    setManualInput('');
    setInputDocuments([]);
    setResultsId('');
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
          onConnections={() => {
            setSettingsOpen(true);
            rememberSettings(true);
          }}
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
  const actionReview = (
    <>
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
              <pre>{JSON.stringify(run.pending.arguments, null, 2)}</pre>
            </details>
            {run.pending.status !== 'awaiting_approval' && (
              <div className="reconcile-form">
                <label htmlFor="wb-field-1" className="field-label">
                  Verify the outcome in the connected app
                  <Textarea
                    id="wb-field-1"
                    value={reconciliation}
                    onChange={(e) => setReconciliation(e.target.value)}
                    placeholder="What happened? Include the resource link or result you checked."
                    maxLength={3000}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={busy || reconciliation.trim().length < 10}
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
                disabled={busy || run.pending.status !== 'awaiting_approval'}
                onClick={() => void act('reject')}
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={busy || run.pending.status !== 'awaiting_approval'}
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
                Dispatch was checkpointed. Reconcile in the app if the response
                was interrupted; it will not automatically replay.
              </p>
            )}
          </div>
        )}
    </>
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
          <SidebarMenu>
            <SidebarMenuItem>
              <TaskButton
                onClick={() => {
                  setSettingsOpen(true);
                  rememberSettings(true);
                  void refreshIntegrations();
                }}
              >
                <Settings2 />
                <span>Settings & integrations</span>
              </TaskButton>
            </SidebarMenuItem>
          </SidebarMenu>
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
            {chat && workflow && (
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
        {chat && workflow && (
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
          <div className="wb-home" style={{ paddingTop: '35%' }}>
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
                <button
                  key={e.title}
                  onClick={() => {
                    setDraft(e.prompt);
                    setSelectedApps(e.apps);
                  }}
                >
                  <Icon size={19} />
                  <strong>{e.title}</strong>
                  <p>{e.description}</p>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
            <section className="finance-demo-gallery" aria-label="Finance demos">
              <h2>Try a finance workflow</h2>
              <p>Synthetic Excel workbooks. No accounting accounts needed.</p>
              {financeDemos.map((d) => <div key={d.id}>
                <Button variant="ghost" onClick={() => { setDraft(d.prompt); setSelectedApps([]); }}><FileText size={16} />{d.title}</Button>
                <a href={`/demos/${d.id}.xlsx`} download>Download Excel input</a>
              </div>)}
            </section>
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
                        onDetails={() => setResultsId(m.runId ?? '')}
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      </article>
                    ),
                  )}
                  {workflow && waitingForConnections && (
                    <article className="wb-message assistant">
                      <div className="message-avatar"><GitBranch size={15} /></div>
                      <div className="message-content connection-prompt">
                        <small>Foundry</small>
                        <h3>Connect the apps this workflow needs</h3>
                        <p>{activeRun ? 'The run waits here while you connect your accounts. Your workflow and input are saved.' : 'Connect these accounts before your next run. Your existing workflow and results are saved.'}</p>
                        {integrations?.connectionError ? <p role="alert">Could not verify connections. Refresh to try again.</p> : missingApps.map((a) => (
                          <Button key={a.slug} variant="outline" disabled={busy || !integrations?.composio} onClick={() => void connect(a.slug)}>
                            <AppIcon slug={a.slug} /> Connect {a.name}
                          </Button>
                        ))}
                        <Button variant="ghost" disabled={busy} onClick={() => void refreshIntegrations().catch((e) => setError(e.message))}>
                          <RotateCcw size={14} /> Check connections
                        </Button>
                        <p className="quiet-text">Using uploaded files instead? Stop the current test, then ask in chat to use documents only.</p>
                      </div>
                    </article>
                  )}
                  {pendingMessage && (
                    <article className="wb-message user">
                      <div className="message-avatar">Y</div>
                      <div className="message-content">
                        <small>You</small>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {pendingMessage}
                        </ReactMarkdown>
                      </div>
                    </article>
                  )}
                  {designing && (
                    <div className="design-progress">
                      <LoaderCircle size={16} className="spin" />
                      <div>
                        <strong>Designing your workflow</strong>
                        <p>
                          {chat.versions.length
                            ? 'Updating the agents with your latest instructions. Your task history and memory stay here.'
                            : 'Identifying the steps, choosing agents, and defining checks for the output.'}
                        </p>
                      </div>
                    </div>
                  )}
                  {!designing &&
                    !manualStarting &&
                    busy &&
                    run?.mode !== 'manual' && (
                      <div className="working-message">
                        <LoaderCircle size={14} className="spin" />
                        {run?.phase === 'prepare'
                          ? 'Creating a test input…'
                          : run?.phase === 'repair'
                            ? 'Improving the workflow…'
                            : run?.phase === 'evaluate'
                              ? 'Checking the output…'
                              : run?.phase === 'reflect'
                                ? 'Learning from this attempt…'
                                : 'Running the next agent…'}
                      </div>
                    )}
                  {testRun && !designing && (
                    <div className="run-chat-card">
                      <div>
                        <strong>
                          {testRun.status === 'completed'
                            ? 'Test passed'
                            : testRun.status === 'running'
                              ? 'Automatic test in progress'
                              : testRun.status.replaceAll('_', ' ')}
                        </strong>
                        <span>
                          Attempt {testRun.attempts.length} /{' '}
                          {testRun.maxIterations}
                        </span>
                      </div>
                      <p>
                        {testRun.error ??
                          (testRun.status === 'running'
                            ? 'Checking the output and improving failed steps.'
                            : 'Tell me what to change, or run this architecture with your own input in the workflow panel.')}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResultsId(testRun.id)}
                      >
                        View test results
                        <ArrowUpRight size={12} />
                      </Button>
                    </div>
                  )}
                  {run?.mode !== 'manual' && actionReview}
                  <div ref={scrollEnd} />
                </div>
                <div className="chat-bottom">
                  {!designing && workflow && (
                    <div className="chat-test-controls">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || Boolean(activeRun)}
                        onClick={() => void act('recovery-checks')}
                      >
                        Recovery checks
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Test limits"
                        onClick={() => {
                          setLimitTarget(
                            Math.round(chat.settings.target * 100),
                          );
                          setLimitAttempts(chat.settings.maxIterations);
                          setLimitTools(chat.settings.maxToolCalls);
                          setLimitsOpen(true);
                        }}
                      >
                        <Settings2 size={13} />
                      </Button>
                      <span>
                        {activeRun
                          ? `Attempt ${activeRun.attempts.length} of ${activeRun.maxIterations}`
                          : `${workflow?.nodes.length ?? 0} agents · target ${percent(chat.settings.target)}`}
                      </span>
                      {activeRun && activeRun.mode !== 'manual' ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              if (activeRun.status === 'paused')
                                void act('resume', {
                                  runId: activeRun.id,
                                }).then(() => setAuto(true));
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
                          disabled={busy || Boolean(activeRun)}
                          onClick={() => void beginRun()}
                        >
                          <FlaskConical size={14} />
                          {run ? 'Test again' : 'Test workflow'}
                        </Button>
                      )}
                    </div>
                  )}
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
            {showCanvas && workflow && (
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
                          size="sm"
                          variant="outline"
                          onClick={() => setTab('manual')}
                        >
                          <Play size={12} />
                          Run with my input
                        </Button>
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

                          <TabsTrigger value="learning">
                            <TrendingUp size={13} />
                            Learning<span>{knowledge.length}</span>
                          </TabsTrigger>
                          <TabsTrigger value="manual">
                            <Play size={13} />
                            My runs<span>{manualRuns.length}</span>
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
                      </TabsContent>
                      <TabsContent value="learning" className="detail-tab">
                        <div className="section-intro">
                          <span className="eyebrow">HOW THIS AGENT IMPROVES</span>
                          <h2>Learning</h2>
                          <p>
                            Task memory stays inside this task. What the agents
                            observe about each app’s tools is shared across your
                            tasks, so a later task starts with what an earlier
                            one worked out.
                          </p>
                        </div>
                        {!metrics.length ? (
                          <div className="wb-empty">
                            <TrendingUp size={28} />
                            <strong>No runs measured yet</strong>
                            <p>
                              Test this workflow to start recording rubric
                              scores, attempts, tokens, and wasted tool calls.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="run-facts">
                              <span>
                                <strong>{metrics.length}</strong>
                                runs measured
                              </span>
                              <span>
                                <strong>
                                  {percent(
                                    metrics.filter((m) => m.passed).length /
                                      metrics.length,
                                  )}
                                </strong>
                                passed
                              </span>
                              <span>
                                <strong>
                                  {median(
                                    metrics
                                      .filter((m) => m.passed)
                                      .map((m) => m.attempts),
                                  ) ?? '—'}
                                </strong>
                                median attempts to pass
                              </span>
                              <span>
                                <strong>
                                  {metrics.some((m) => m.costUsd === null)
                                    ? 'Unpriced'
                                    : money(
                                        metrics.reduce(
                                          (n, m) => n + (m.costUsd ?? 0),
                                          0,
                                        ),
                                      )}
                                </strong>
                                total model cost
                              </span>
                            </div>
                            <div className="trend-grid">
                              <TrendLine
                                points={trend}
                                accessor={(pt) => pt.score}
                                max={1}
                                target={chat.settings.target}
                                label="Rubric score per run"
                                format={(v) => percent(v)}
                              />
                              <TrendLine
                                points={trend}
                                accessor={(pt) => pt.toolErrors}
                                max={Math.max(
                                  1,
                                  ...trend.map((pt) => pt.toolErrors),
                                )}
                                label="Wasted tool calls per run"
                                format={(v) => String(v)}
                              />
                            </div>
                            <p className="quiet-text">
                              A rubric score is a judged result against this
                              task’s frozen checks, not measured accuracy. Hollow
                              points are runs with memory switched off.
                            </p>
                          </>
                        )}
                        <div className="section-intro learning-section">
                          <h2>Tool knowledge</h2>
                          <p>
                            Derived from tool schemas and error signatures only.
                            A rule stays proposed until a different run observes
                            it again, and only confirmed rules reach a prompt.
                          </p>
                        </div>
                        {!knowledge.length ? (
                          <div className="wb-empty">
                            <Layers3 size={28} />
                            <strong>Nothing learned yet</strong>
                            <p>
                              Connect an app and run a workflow that uses it.
                              What the tools accept and reject is recorded here.
                            </p>
                          </div>
                        ) : (
                          knowledge.map((k) => (
                            <article className="memory-card" key={k.id}>
                              <div>
                                <span>{k.toolkit}</span>
                                <span className={`memory-status ${k.status}`}>
                                  {k.status}
                                </span>
                              </div>
                              <p>{k.claim}</p>
                              <small>
                                observed {k.observations}× · {k.successes}{' '}
                                succeeded · {k.failures} failed
                                {k.slug ? ` · ${k.slug}` : ''}
                              </small>
                              <details>
                                <summary>Source evidence</summary>
                                {k.evidence.map((id) => (
                                  <code key={id}>{id}</code>
                                ))}
                                <span>First seen in run {k.firstRun}</span>
                              </details>
                            </article>
                          ))
                        )}
                        <p className="quiet-text">
                          Shared across your tasks. Task content never is: a
                          rule that echoes your documents or inputs is dropped
                          rather than rewritten.
                        </p>
                        <div className="section-intro learning-section">
                          <h2>Does memory actually help?</h2>
                          <p>
                            Runs the same input with task memory on and off, on a
                            frozen graph. Tool knowledge stays fixed in both arms. Arms run
                            one at a time and stay out of the conversation.
                          </p>
                        </div>
                        {experiment && experiment.status === 'running' ? (
                          <div className="ab-progress">
                            <span>
                              Arm {finishedArms + 1} of{' '}
                              {experiment.arms.length} ·{' '}
                              {experiment.arms.find(
                                (a) => a.status === 'running',
                              )?.useMemory
                                ? 'memory on'
                                : 'memory off'}
                            </span>
                            <div className="experiment-arms">
                              {experiment.arms.map((a) => (
                                <i
                                  key={a.index}
                                  className={`${a.status} ${a.useMemory ? 'with-memory' : 'without-memory'}`}
                                  title={`Arm ${a.index + 1} · ${a.useMemory ? 'memory on' : 'memory off'} · ${a.status}`}
                                />
                              ))}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setAuto(false);
                                void act('experiment', { operation: 'cancel' });
                              }}
                            >
                              Cancel experiment
                            </Button>
                          </div>
                        ) : (
                          <>
                            <label className="field-label" htmlFor="wb-ab-input">
                              One fixed input, used by every arm
                              <Textarea
                                id="wb-ab-input"
                                value={abInput}
                                onChange={(e) => setAbInput(e.target.value)}
                                placeholder="Paste the content every arm should process…"
                                maxLength={12000}
                                rows={4}
                              />
                            </label>
                            <div className="manual-controls">
                              <NativeSelect
                                aria-label="Pairs"
                                value={abPairs}
                                onChange={(e) =>
                                  setAbPairs(Number(e.target.value))
                                }
                              >
                                {Array.from(
                                  { length: MAX_PAIRS },
                                  (_, i) => i + 1,
                                ).map((n) => (
                                  <NativeSelectOption key={n} value={n}>
                                    {n} pair{n > 1 ? 's' : ''} · {n * 2} runs
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                              <Button
                                disabled={
                                  busy ||
                                  Boolean(activeRun) ||
                                  !abInput.trim() ||
                                  !chat.memory.length
                                }
                                onClick={() => void beginExperiment()}
                              >
                                <FlaskConical size={14} />
                                Run experiment
                              </Button>
                            </div>
                            <p className="quiet-text">
                              {!chat.memory.length
                                ? 'This task has no memory yet, so both arms would be identical. Test the workflow at least once first.'
                                : `This spends real model budget: ${abPairs * 2} runs, capped at 2 attempts and 8 tool calls each.`}
                            </p>
                          </>
                        )}
                        {experiment && experiment.error && (
                          <p className="evaluation-issue">{experiment.error}</p>
                        )}
                        {armResult && finishedArms > 0 && (
                          <div className="ab-result">
                            <strong
                              className={`ab-verdict ${armResult.verdict}`}
                            >
                              {armResult.verdict === 'insufficient_data'
                                ? `Not enough data to answer yet (${armResult.nPerArm} per arm).`
                                : armResult.verdict === 'memory_helped'
                                  ? 'Memory helped on this task.'
                                  : armResult.verdict === 'memory_hurt'
                                    ? 'Memory did not help on this task.'
                                    : 'No measurable difference on this task.'}
                            </strong>
                            <PairedBars
                              label="Pass rate"
                              memory={armResult.memory.passRate}
                              control={armResult.control.passRate}
                              format={(v) => percent(v)}
                            />
                            <PairedBars
                              label="Attempts to finish"
                              memory={armResult.memory.medianAttempts}
                              control={armResult.control.medianAttempts}
                              format={(v) => v.toFixed(1)}
                              lowerIsBetter
                            />
                            <PairedBars
                              label="Wasted tool calls"
                              memory={armResult.memory.medianToolErrors}
                              control={armResult.control.medianToolErrors}
                              format={(v) => v.toFixed(1)}
                              lowerIsBetter
                            />
                            <PairedBars
                              label="Tokens"
                              memory={armResult.memory.medianTokens}
                              control={armResult.control.medianTokens}
                              format={(v) => v.toLocaleString()}
                              lowerIsBetter
                            />
                            <p className="quiet-text">
                              {armResult.nPerArm} run
                              {armResult.nPerArm === 1 ? '' : 's'} per arm on one
                              input. Directional only — this is not a
                              significance test, and a null result is reported as
                              a null result.
                            </p>
                          </div>
                        )}
                      </TabsContent>
                      <TabsContent
                        value="manual"
                        className="detail-tab manual-run-tab"
                      >
                        <div className="section-intro">
                          <h2>Run with your input</h2>
                          <p>
                            Use the current architecture on your own content.
                            This executes once and keeps the output here.
                          </p>
                        </div>
                        <label
                          className="field-label"
                          htmlFor="manual-run-input"
                        >
                          Input for the first agent
                          <Textarea
                            id="manual-run-input"
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder="Paste your content, data, or a source URL…"
                            maxLength={12000}
                            rows={5}
                          />
                        </label>
                        <DocumentInput
                          key={chat.id}
                          documents={inputDocuments}
                          onChange={setInputDocuments}
                          onLoading={setReadingDocument}
                          disabled={busy || Boolean(activeRun)}
                        />
                        {financeDemos.filter((d) => d.title === chat.title).map((d) => <div className="demo-input-actions" key={d.id}>
                          <Button variant="outline" disabled={busy || Boolean(activeRun) || readingDocument} onClick={async () => {
                            setReadingDocument(true);
                            try {
                              const response = await fetch(`/demos/${d.id}.xlsx`);
                              if (!response.ok) throw new Error('Could not load the demo workbook.');
                              const bytes = new Uint8Array(await response.arrayBuffer());
                              const { extractWorkbook } = await import('@/lib/workbench/xlsx-input');
                              setInputDocuments([{name:`${d.id}.xlsx`,size:bytes.length,text:extractWorkbook(bytes)}]);
                              setManualInput('Process the attached synthetic workbook. Return the complete deliverable and exceptions.');
                            } catch(e) {setError(e instanceof Error ? e.message : 'Could not read workbook');}
                            finally {setReadingDocument(false);}
                          }}>Use demo Excel input</Button>
                          <a href={`/demos/${d.id}.xlsx`} download>Download workbook</a>
                        </div>)}
                        <p className="quiet-text">
                          {(
                            manualInput.length +
                            inputDocuments.reduce(
                              (n, d) => n + d.text.length + d.name.length + 12,
                              0,
                            )
                          ).toLocaleString()}{' '}
                          / 12,000 input characters
                        </p>
                        <div className="manual-controls">
                          {activeRun?.mode === 'manual' ? (
                            <>
                              <Button
                                disabled={busy}
                                variant="outline"
                                onClick={() => {
                                  if (activeRun.status === 'paused')
                                    void act('resume', {
                                      runId: activeRun.id,
                                    }).then(() => setAuto(true));
                                  else if (!auto) setAuto(true);
                                  else {
                                    setAuto(false);
                                    void act('pause', { runId: activeRun.id });
                                  }
                                }}
                              >
                                {auto ? 'Pause' : 'Continue'}
                              </Button>
                              <Button
                                disabled={busy}
                                variant="ghost"
                                onClick={() => {
                                  setAuto(false);
                                  void act('pause', {
                                    runId: activeRun.id,
                                    stop: true,
                                  });
                                }}
                              >
                                Stop run
                              </Button>
                            </>
                          ) : (
                            <Button
                              disabled={
                                busy ||
                                Boolean(activeRun) ||
                                readingDocument ||
                                manualInput.length +
                                  inputDocuments.reduce(
                                    (n, d) =>
                                      n + d.text.length + d.name.length + 12,
                                    0,
                                  ) >
                                  12000 ||
                                (!manualInput.trim() && !inputDocuments.length)
                              }
                              onClick={() => void beginManual()}
                            >
                              <Play size={13} />
                              Run agents
                            </Button>
                          )}
                        </div>
                        {activeRun && activeRun.mode !== 'manual' && (
                          <p className="quiet-text">
                            The automatic test is running in chat. Finish or
                            stop it before starting your own run.
                          </p>
                        )}
                        {manualRuns.length > 0 && (
                          <NativeSelect
                            aria-label="Manual run history"
                            value={manualRun?.id ?? ''}
                            disabled={Boolean(activeRun)}
                            onChange={(e) => setSelectedRunId(e.target.value)}
                          >
                            {manualRuns.map((r, i) => (
                              <NativeSelectOption value={r.id} key={r.id}>
                                Run {manualRuns.length - i} ·{' '}
                                {r.status.replaceAll('_', ' ')}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                        {manualRun && (
                          <>
                            <div className="manual-status">
                              <strong>
                                {manualRun.status.replaceAll('_', ' ')}
                              </strong>
                              <span>
                                {manualRun.usage.inputTokens +
                                  manualRun.usage.outputTokens}{' '}
                                tokens · {money(manualRun.usage.costUsd)}
                              </span>
                            </div>
                            {manualRun.status === 'completed' && <Button variant="outline" size="sm" onClick={() => {
                              const last = manualRun.attempts.at(-1)!;
                              const output = last.states.filter((s) => !last.workflow.nodes.some((n) => n.dependsOn.includes(s.nodeId))).map((s) => s.output).join('\n\n');
                              const url = URL.createObjectURL(new Blob([output], {type:'text/markdown;charset=utf-8'}));
                              const a = document.createElement('a'); a.href=url; a.download=`foundry-output-${manualRun.id.slice(0,8)}.md`; a.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            }}>Download final output</Button>}
                            {manualRun.error && (
                              <p role="alert">{manualRun.error}</p>
                            )}
                            <details className="schema-detail">
                              <summary>Input used for this run</summary>
                              <pre>{manualRun.input}</pre>
                            </details>
                            {manualRun.attempts.at(-1)?.states.map((state) => (
                              <details
                                className="manual-output"
                                key={state.nodeId}
                                open={state.status === 'done'}
                              >
                                <summary>
                                  {
                                    manualRun.attempts[0].workflow.nodes.find(
                                      (n) => n.id === state.nodeId,
                                    )?.name
                                  }{' '}
                                  · {state.status}
                                </summary>
                                <div className="message-content">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {state.output ||
                                      state.error ||
                                      'Waiting for this agent.'}
                                  </ReactMarkdown>
                                </div>
                              </details>
                            ))}
                            {manualRun.attempts
                              .flatMap((a) => a.traces)
                              .filter((t) => t.name.startsWith('Recovery:'))
                              .map((t) => (
                                <details className="schema-detail" key={t.id}>
                                  <summary>{t.name}</summary>
                                  <p>{t.output}</p>
                                </details>
                              ))}
                            {run?.mode === 'manual' && actionReview}
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
      {resultsId && (
        <TestResults
          key={resultsId}
          initialId={resultsId}
          runs={testRuns}
          onClose={() => setResultsId('')}
        />
      )}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          rememberSettings(open);
          if (!open) setAllAppsOpen(false);
        }}
      >
        <DialogContent
          className={`wb-dialog settings-dialog${allAppsOpen ? ' browsing-apps' : ''}`}
        >
          <DialogHeader>
            <DialogTitle>
              {allAppsOpen ? 'All apps' : 'Connections & settings'}
            </DialogTitle>
            <DialogDescription>
              {allAppsOpen
                ? 'Connect an account to let your agents use it. The actual actions are discovered when a workflow runs.'
                : 'Give your agents access to the tools you work in.'}
            </DialogDescription>
          </DialogHeader>
          {/* One dialog, two views. A second modal fought this one for the
              overlay and focus trap, and its content never rendered. */}
          {allAppsOpen ? (
            <>
              <button
                type="button"
                className="see-all-apps back-to-settings"
                onClick={() => setAllAppsOpen(false)}
              >
                Back to connections
              </button>
              <input
                className="all-apps-search"
                aria-label="Search apps"
                placeholder={`Search ${ALL_APPS.length.toLocaleString()} apps`}
                value={appQuery}
                onChange={(e) => {
                  setAppQuery(e.target.value);
                  setAppLimit(120);
                }}
              />
              {!browsedApps.length ? (
                <p className="all-apps-empty">No apps match “{appQuery}”.</p>
              ) : (
                <div className="all-apps-grid" style={appGridStyle}>
                  {browsedApps.slice(0, appLimit).map((app) => {
                    const c = integrations?.connections.find(
                      (c) => c.slug === app.slug,
                    );
                    const connected =
                      c?.connection?.is_active ||
                      c?.connection?.isActive ||
                      c?.connection?.connected_account?.status === 'ACTIVE';
                    return (
                      <button
                        key={app.slug}
                        type="button"
                        style={appTileStyle}
                        className={connected ? 'connected' : ''}
                        title={app.description}
                        disabled={busy || !integrations?.composio || app.noAuth}
                        onClick={() => void connect(app.slug)}
                      >
                        <AppIcon slug={app.slug} size={24} />
                        <span>{app.name}</span>
                        {(connected || app.noAuth) && (
                          <i aria-hidden="true">
                            <Check size={10} />
                          </i>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {browsedApps.length > appLimit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAppLimit(appLimit + 200)}
                >
                  Show more ({(browsedApps.length - appLimit).toLocaleString()}{' '}
                  remaining)
                </Button>
              ) : (
                <p className="all-apps-count">
                  {browsedApps.length.toLocaleString()} app
                  {browsedApps.length === 1 ? '' : 's'}
                  {appQuery ? ' matching your search' : ''}
                </p>
              )}
            </>
          ) : (
            <>
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
            <div className="connection-list">
              {featuredApps.map((app) => {
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
                        {app.noAuth
                          ? 'Ready · no account needed'
                          : connected
                            ? 'Connected'
                            : 'Account not connected'}
                      </small>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !integrations?.composio || app.noAuth}
                      onClick={() => void connect(app.slug)}
                    >
                      {app.noAuth
                        ? 'Ready'
                        : connected
                          ? 'Reconnect'
                          : 'Connect'}
                      <ArrowUpRight size={12} />
                    </Button>
                  </div>
                );
              })}
            </div>
            <button
              style={{ paddingTop: '20px' }}
              type="button"
              className="see-all-apps"
              onClick={() => {
                setAppQuery('');
                setAppLimit(120);
                setAllAppsOpen(true);
              }}
            >
              {/* <Layers3 size={14} /> */}
              See all {ALL_APPS.length.toLocaleString()} apps
              {/* <ArrowUpRight size={12} /> */}
            </button>
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
