import { validateWorkflow } from './validation.ts';
import { cleanRules } from './workspace.ts';
import { createChat } from './engine.ts';
import { digest } from './digest.ts';
import type { Chat, Workflow } from './types.ts';
export interface PublishedWorkflow {
  title: string;
  description: string;
  workflow: Workflow;
  rules: string[];
  versionDigest: string;
  createdAt: string;
}
export async function publication(
  chat: Chat,
  description: unknown,
): Promise<PublishedWorkflow> {
  if (
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 2000
  )
    throw Error('Add a public description of 1–2,000 characters.');
  const workflow = structuredClone(
    validateWorkflow(chat.versions.at(-1)?.workflow),
  );
  return {
    title: workflow.title,
    description: description.trim(),
    workflow,
    rules: cleanRules(chat.rules ?? []),
    versionDigest: await digest(workflow),
    createdAt: new Date().toISOString(),
  };
}
export async function instantiatePublished(
  id: string,
  published: PublishedWorkflow,
): Promise<Chat> {
  // Allowlist projection: never clone the publisher's Chat, connections, memory, or tests.
  const chat = createChat(crypto.randomUUID());
  chat.title = published.title;
  chat.sourceShare = id;
  chat.rules = structuredClone(published.rules);
  const workflow = structuredClone(validateWorkflow(published.workflow));
  chat.versions = [
    {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      workflow,
      digest: await digest(workflow),
      reason: 'Private session from published version',
    },
  ];
  chat.selectedApps = [...new Set(workflow.nodes.flatMap((n) => n.toolkits))];
  chat.settings = { target: 0.85, maxIterations: 1, maxToolCalls: 8 };
  return chat;
}
