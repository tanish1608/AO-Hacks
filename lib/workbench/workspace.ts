import type { Run } from './types.ts';

export interface WorkflowRow {
  id: string;
  title: string;
  updated_at: string;
  steps: number;
  latestRun: { id: string; status: Run['status']; mode: string | null; error: string | null; updatedAt: string; pendingStatus: string | null } | null;
}
export type WorkFilter = 'all' | 'attention' | 'active' | 'completed';
export function workflowState(row: WorkflowRow) {
  const run = row.latestRun;
  if (run?.pendingStatus === 'unknown' || run?.pendingStatus === 'executing')
    return { group: 'attention', label: 'Check external action', detail: 'Confirm the outcome in the connected app before continuing.' };
  if (run?.status === 'awaiting_approval')
    return { group: 'attention', label: 'Review action', detail: 'A proposed change is waiting for your approval.' };
  if (run?.status === 'paused')
    return { group: 'attention', label: 'Paused', detail: 'Open this workflow to continue or stop the run.' };
  if (run && ['blocked', 'failed', 'exhausted'].includes(run.status))
    return { group: 'attention', label: run.status === 'failed' ? 'Run failed' : 'Needs attention', detail: run.error || 'Open the run to review missing inputs and results.' };
  if (run?.status === 'running')
    return { group: 'active', label: 'In progress', detail: 'Keep the workflow open while it runs.' };
  if (run?.status === 'completed')
    return { group: 'completed', label: run.mode === 'manual' ? 'Run completed' : 'Test completed', detail: 'Review the output and evidence before using the result.' };
  return { group: 'draft', label: row.steps ? 'Ready to test' : 'Draft', detail: row.steps ? 'Add your input or test with a sample.' : 'Continue describing the work to build a workflow.' };
}

export function cleanRules(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 20 || input.some(r => typeof r !== 'string' || !r.trim() || r.length > 1000))
    throw new Error('Add up to 20 rules, each between 1 and 1,000 characters.');
  return [...new Set(input.map(r => (r as string).trim()))];
}
