const str = { type: 'string' };
const strings = { type: 'array', items: str };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const workflowSchema = object({
  title: str,
  explanation: str,
  nodes: {
    type: 'array',
    items: object({
      id: str,
      name: str,
      role: str,
      instruction: str,
      toolkits: strings,
      dependsOn: strings,
    }),
  },
  criteria: {
    type: 'array',
    items: object({
      id: str,
      name: str,
      description: str,
      weight: { type: 'number' },
      required: { type: 'boolean' },
      assertion: object({
        kind: {
          type: 'string',
          enum: ['rubric', 'word_count', 'contains', 'excludes'],
        },
        min: { type: 'integer' },
        max: { type: 'integer' },
        terms: strings,
      }),
    }),
  },
});
export const actionSchema = object({
  action: { type: 'string', enum: ['finish', 'tool', 'blocked'] },
  output: str,
  toolSlug: str,
  argumentsJson: str,
  reason: str,
});
export const evaluationSchema = object({
  score: { type: 'number' },
  verdict: { type: 'string', enum: ['pass', 'revise', 'blocked'] },
  summary: str,
  issues: strings,
  checks: {
    type: 'array',
    items: object({
      criterionId: str,
      score: { type: 'number' },
      rationale: str,
      evidenceIds: strings,
      verified: { type: 'boolean' },
    }),
  },
  memoryVerdicts: {
    type: 'array',
    items: object({
      id: str,
      verdict: {
        type: 'string',
        enum: ['supported', 'contradicted', 'unassessed'],
      },
      evidenceIds: strings,
    }),
  },
});
export const reflectionSchema = object({
  summary: str,
  repairInstructions: str,
  memories: {
    type: 'array',
    items: object({
      kind: {
        type: 'string',
        enum: ['context', 'tool_rule', 'preference', 'strategy', 'failure'],
      },
      content: str,
      evidence: strings,
    }),
  },
});
