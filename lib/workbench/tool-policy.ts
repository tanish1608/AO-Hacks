// Explicitly reviewed read operations. A tool name prefix or model reflection never grants permission.
// Semantics verified against live Composio schemas on 2026-09-05.
const REVIEWED_READS = new Set([
  'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
  'GOOGLEDOCS_SEARCH_DOCUMENTS',
  // Zoho Books read endpoints verified against provider docs and live responses.
  'ZOHO_BOOKS_LIST_ORGANIZATIONS',
  'ZOHO_BOOKS_GET_ORGANIZATION',
  'ZOHO_BOOKS_LIST_CONTACTS',
  'ZOHO_BOOKS_GET_CONTACT',
  'ZOHO_BOOKS_LIST_INVOICES',
  'ZOHO_BOOKS_GET_INVOICE',
  'ZOHO_BOOKS_LIST_CURRENCIES',
]);
export function isReviewedRead(slug: string, annotation?: boolean) {
  return annotation === true || REVIEWED_READS.has(slug);
}
