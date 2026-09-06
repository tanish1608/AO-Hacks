import type { Json, Usage } from '../engine/types.ts';
export interface AgentNode {
  id: string;
  name: string;
  role: string;
  instruction: string;
  toolkits: string[];
  dependsOn: string[];
}
export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  required: boolean;
  assertion?: {
    kind: 'rubric' | 'word_count' | 'contains' | 'excludes';
    min: number;
    max: number;
    terms: string[];
  };
}
export interface Workflow {
  title: string;
  explanation: string;
  nodes: AgentNode[];
  criteria: Criterion[];
}
export interface WorkflowVersion {
  id: string;
  createdAt: string;
  workflow: Workflow;
  digest: string;
  reason: string;
}
export interface Message {
  kind?:
    | 'test_input'
    | 'run_started'
    | 'agent_result'
    | 'evaluation'
    | 'reflection'
    | 'repair'
    | 'run_finished';
  runId?: string;
  attemptId?: string;
  nodeId?: string;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface Memory {
  id: string;
  kind: 'context' | 'tool_rule' | 'preference' | 'strategy' | 'failure';
  content: string;
  evidence: string[];
  status: 'proposed' | 'supported' | 'contradicted' | 'user_confirmed';
  createdAt: string;
  updatedAt: string;
  sourceRun: string;
  supportedRuns: string[];
  usedCount: number;
}
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  messages: Message[];
  versions: WorkflowVersion[];
  memory: Memory[];
  settings: { target: number; maxIterations: number; maxToolCalls: number };
  selectedApps?: string[];
  sessionId: string | null;
  modelUsage: Usage;
}
export interface Observation {
  id: string;
  nodeId: string;
  kind: 'model' | 'tool' | 'search' | 'evaluation' | 'reflection' | 'repair';
  name: string;
  at: string;
  durationMs: number;
  input: string;
  output: string;
  error: string | null;
  usage: Usage;
  langsmith: 'disabled' | 'sent' | 'failed';
}
export interface AgentState {
  nodeId: string;
  status: 'pending' | 'working' | 'done' | 'blocked';
  output: string;
  turns: number;
  observations: string[];
  tools: DiscoveredTool[];
  error: string | null;
  blockReason?: 'connection' | 'input' | 'budget' | 'execution';
}
export interface DiscoveredTool {
  slug: string;
  toolkit: string;
  description: string;
  schema: Record<string, unknown>;
  readOnly: boolean;
  connected?: boolean;
}
export interface Check {
  criterionId: string;
  score: number;
  rationale: string;
  evidenceIds: string[];
  verified: boolean;
}
export interface Evaluation {
  score: number;
  verdict: 'pass' | 'revise' | 'blocked';
  checks: Check[];
  summary: string;
  issues: string[];
  memoryVerdicts: {
    id: string;
    verdict: 'supported' | 'contradicted' | 'unassessed';
    evidenceIds: string[];
  }[];
}
export interface Attempt {
  id: string;
  iteration: number;
  workflow: Workflow;
  graphDigest: string;
  states: AgentState[];
  traces: Observation[];
  evaluation: Evaluation | null;
  memoryIds: string[];
  startedAt: string;
  finishedAt: string | null;
}
export interface PendingAction {
  id: string;
  nodeId: string;
  tool: DiscoveredTool;
  arguments: Record<string, Json>;
  description: string;
  status: 'awaiting_approval' | 'executing' | 'unknown';
}
export interface Run {
  mode?: 'test' | 'manual';
  input?: string;
  inputOrigin?: 'generated' | 'user';
  inputExplanation?: string;
  id: string;
  chatId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status:
    | 'running'
    | 'paused'
    | 'awaiting_approval'
    | 'completed'
    | 'exhausted'
    | 'blocked'
    | 'failed';
  phase: 'prepare' | 'execute' | 'evaluate' | 'reflect' | 'repair' | 'done';
  attempts: Attempt[];
  rubric: Criterion[];
  target: number;
  maxIterations: number;
  maxToolCalls: number;
  pending: PendingAction | null;
  usage: Usage;
  error: string | null;
  useMemory: boolean;
}
export interface ModelResult<T> {
  value: T;
  usage: Usage;
  durationMs: number;
}
export interface Model {
  json<T>(
    system: string,
    input: unknown,
    schema: Record<string, unknown>,
  ): Promise<ModelResult<T>>;
}
export interface Tools {
  search(query: string, toolkits: string[]): Promise<DiscoveredTool[]>;
  execute(slug: string, args: Record<string, Json>): Promise<unknown>;
}
export interface Dependencies {
  model: Model;
  tools: Tools | null;
  now?: () => string;
  trace?: (
    trace: Observation,
    runId: string,
  ) => Promise<'disabled' | 'sent' | 'failed'>;
}
export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  model: null,
});
export function addUsage(a: Usage, b: Usage) {
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.costUsd =
    a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd;
  a.model = b.model ?? a.model;
}
