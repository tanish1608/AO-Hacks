export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_CHARACTERS = 12000;
export const DOCUMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json';
export type InputDocument = { name: string; text: string; size: number };
export function validateDocument(name: string, size: number) {
  const extension = name.toLowerCase().split('.').at(-1) ?? '';
  if (!['pdf', 'docx', 'txt', 'md', 'csv', 'json'].includes(extension))
    throw new Error(
      'Choose a PDF, DOCX, TXT, Markdown, CSV, or JSON document.',
    );
  if (!size || size > MAX_DOCUMENT_BYTES)
    throw new Error('Choose a nonempty document smaller than 10 MB.');
  return extension;
}
export function combineRunInput(
  instruction: string,
  documents: InputDocument[],
) {
  if (documents.some((d) => !d.text.trim()))
    throw new Error(
      'An attached document has no text. Add an excerpt or remove it before running.',
    );
  const input = [
    instruction.trim(),
    ...documents.map((d) => `Document: ${d.name}\n${d.text.trim()}`),
  ]
    .filter(Boolean)
    .join('\n\n');
  if (input.length > MAX_INPUT_CHARACTERS)
    throw new Error(
      `Combined input is ${input.length.toLocaleString()} characters; the limit is 12,000. Shorten the document excerpt or instructions before running.`,
    );
  return input;
}
export function validateExtractedText(text: string) {
  const result = text.replaceAll('\u0000', '').trim();
  if (!result)
    throw new Error(
      'No readable text found. For a scanned PDF, export it with OCR or paste the text.',
    );
  if (result.length > 1000000)
    throw new Error(
      'The extracted document is too large. Upload a shorter excerpt.',
    );
  return result;
}
