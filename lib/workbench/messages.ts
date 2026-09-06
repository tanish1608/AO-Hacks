import type { Message } from './types.ts';
/** Keep the task and recent user instructions when a long test loop fills the chat. */
export function retainMessages(messages: Message[], limit = 80): Message[] {
  if (messages.length <= limit) return messages;
  const userIndexes = messages.flatMap((m, i) =>
    m.role === 'user' ? [i] : [],
  );
  const pinned = new Set(
    [userIndexes[0], ...userIndexes.slice(-3)].filter((i) => i !== undefined),
  );
  const tailStart = messages.length - (limit - pinned.size);
  return messages.filter((_, i) => pinned.has(i) || i >= tailStart);
}
