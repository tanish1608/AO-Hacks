import type { Attempt, Chat, Run } from './types.ts';
/**
 * Task content must never reach the owner-scoped tool-knowledge store. Derived
 * records (tool-knowledge.ts) are safe by construction because they carry only
 * argument keys and classified error tokens. Model-authored claims are not, so
 * they pass through here and are dropped — never rewritten — when they overlap
 * the task at all.
 */
const GRAM = 6;
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
function grams(text: string, n = GRAM) {
  const w = words(text),
    out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
/** Everything a claim is forbidden to echo: inputs, outputs, tool arguments, user turns. */
export function taskCorpus(chat: Chat, run: Run, attempt: Attempt): string {
  const parts: string[] = [chat.title, run.input ?? '', run.inputExplanation ?? ''];
  for (const m of chat.messages) if (m.role === 'user' || m.kind === 'agent_result') parts.push(m.content);
  for (const s of attempt.states) parts.push(s.output, s.error ?? '');
  for (const t of attempt.traces) {
    if (t.kind === 'tool') parts.push(t.input, t.output);
    if (t.kind === 'model') parts.push(t.output);
  }
  return parts.filter(Boolean).join('\n');
}
const FORBIDDEN = [
  /https?:\/\//i, // links
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // addresses
  /\d{6,}/, // ids and long numbers
  /\b[0-9a-f]{16,}\b/i, // hashes and keys
  /["“][^"”]{41,}["”]/, // a long quoted span is transcribed content
];
/**
 * Returns the claim when it describes tool behavior and nothing else, or null.
 * `anchors` are the slugs and toolkits actually discovered in this attempt: a
 * claim that names none of them is not a tool rule.
 */
export function sanitizeToolClaim(
  claim: unknown,
  corpus: string,
  anchors: string[],
): string | null {
  if (typeof claim !== 'string') return null;
  const text = claim.trim().replace(/\s+/g, ' ');
  if (text.length < 12 || text.length > 240) return null;
  if (FORBIDDEN.some((r) => r.test(text))) return null;
  const lower = text.toLowerCase();
  if (!anchors.some((a) => a && lower.includes(a.toLowerCase()))) return null;
  const taskGrams = grams(corpus);
  for (const g of grams(text)) if (taskGrams.has(g)) return null;
  return text;
}
