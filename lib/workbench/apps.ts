import catalog from './app-catalog.json' with { type: 'json' };
export type AppDefinition = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  noAuth?: boolean;
};
export const ALL_APPS: AppDefinition[] = catalog;
export const FINANCE_APPS = [
  'quickbooks',
  'xero',
  'zoho_books',
  'netsuite',
  'stripe',
  'brex',
  'ramp',
];
const featured = [
  'googledocs',
  'googleslides',
  'googledrive',
  'googlesheets',
  'composio_search',
  'serpapi',
  'notion',
  'github',
  'slack',
  'gmail',
  'linear',
  'trello',
  ...FINANCE_APPS,
];
const descriptions: Record<string, string> = {
  googledocs: 'Read and write documents',
  googleslides: 'Create and edit presentations',
  googledrive: 'Find, organize, and export files',
  googlesheets: 'Analyze and update spreadsheets',
  notion: 'Pages and databases',
  github: 'Issues, pull requests, and code',
  slack: 'Channels and messages',
  gmail: 'Find and prepare email',
  linear: 'Issues and project planning',
  trello: 'Boards, lists, and cards',
  quickbooks: 'Ledger, bills, invoices, and balances',
  xero: 'Invoices, bank transactions, and reports',
  zoho_books: 'Books, receivables, and payables',
  netsuite: 'Accounting and enterprise reporting',
  stripe: 'Billing, payouts, and reconciliation',
  brex: 'Corporate spend and expense records',
  ramp: 'Expenses, receipts, and spend controls',
};
export const APP_CATALOG: AppDefinition[] = featured
  .map((slug) => ALL_APPS.find((a) => a.slug === slug)!)
  .filter(Boolean)
  .map((a) =>
    a.slug === 'serpapi'
      ? {
          ...a,
          name: 'Google Search (SerpApi)',
          description: 'Google results using your SerpApi account',
        }
      : a.slug === 'composio_search'
        ? {
            ...a,
            name: 'Web Search',
            description: 'Public web research and source URLs · ready to use',
          }
        : {
            ...a,
            name: a.slug === 'netsuite' ? 'NetSuite' : a.name,
            description: descriptions[a.slug] ?? a.description,
          },
  );
export function appDefinition(slug: string) {
  return (
    APP_CATALOG.find((a) => a.slug === slug) ??
    ALL_APPS.find((a) => a.slug === slug)
  );
}
export function validateAppSelection(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some(
      (s) => typeof s !== 'string' || !ALL_APPS.some((a) => a.slug === s),
    )
  )
    throw new Error('Choose up to eight supported apps.');
  return [...new Set(value)] as string[];
}
