// Explicitly reviewed read operations. A tool name prefix or model reflection never grants permission.
// Semantics verified against live Composio schemas on 2026-09-05.
const REVIEWED_READS = new Set([
  'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
  'GOOGLEDOCS_SEARCH_DOCUMENTS',
]);
export function isReviewedRead(slug: string, annotation?: boolean) {
  return annotation === true || REVIEWED_READS.has(slug);
}
