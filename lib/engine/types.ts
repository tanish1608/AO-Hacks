export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ToolId = 'identity' | 'normalize_records' | 'deduplicate_records' | 'filter_records' | 'sum_records' | 'sort_jobs' | 'allocate_jobs' | 'check_policy' | 'resolve_request';
export interface ToolNode { id: string; tool: ToolId; config: Record<string, Json>; }
export interface Architecture { name: string; hypothesis: string; nodes: ToolNode[]; }
export interface Assertion { path: string; operator: 'equals' | 'lte' | 'gte' | 'length'; value: Json; }
export interface Fixture { id: string; input: Record<string, Json>; assertions: Assertion[]; }
export interface TaskContract { id: string; name: string; domain: string; goal: string; tools: ToolId[]; development: Fixture[]; validation: Fixture[]; test: Fixture[]; }
export interface Trace { nodeId: string; tool: string; inputHash: string; output: Json; durationMs: number; error?: string; }
export interface CaseResult { caseId: string; repeat: number; passed: boolean; failures: string[]; toolCalls: number; durationMs: number; traces: Trace[]; }
export interface Evaluation { accuracy: number; reliability: number; medianMs: number; p95Ms: number; meanToolCalls: number; cases: number; executions: number; results: CaseResult[]; }
export interface Usage { inputTokens: number; outputTokens: number; costUsd: number | null; model: string | null; }
export interface Candidate { id: string; generation: number; architecture: Architecture; digest: string; development: Evaluation; validation: Evaluation; decision: 'baseline' | 'accepted' | 'rejected'; reason: string; usage: Usage; }
export interface ExperimentConfig { name: string; mode: 'reference' | 'model'; contract: TaskContract; iterations: number; repeats: number; qualityFloor: number; maxToolCalls: number; tokenBudget: number; }
export interface AuditEvent { sequence: number; type: string; at: string; detail: string; previousHash: string; hash: string; }
export interface Experiment { id: string; config: ExperimentConfig; createdAt: string; updatedAt: string; revision: number; status: 'ready' | 'running' | 'completed' | 'failed' | 'cancelled'; phase: string; candidates: Candidate[]; selectedId: string | null; sealed: { baseline: Evaluation; selected: Evaluation } | null; events: AuditEvent[]; error: string | null; usage: Usage; }
export interface ModelProvider { generate(input: { contract: Pick<TaskContract, 'goal' | 'tools'>; previous: Architecture | null; failures: { caseId: string; input: Record<string, Json>; failures: string[]; traces: Trace[] }[]; generation: number; maxOutputTokens: number; maxTotalTokens?: number }): Promise<{ architecture: Architecture; usage: Usage }>; }
