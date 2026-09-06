import { Validator } from '@cfworker/json-schema';
import type { DiscoveredTool, Attempt } from './types.ts';

const id = { type: 'string', pattern: '^[0-9]+$' };
const text = { type: 'string', minLength: 1, maxLength: 500 };
const amount = { type: 'number', minimum: 0 };
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', additionalProperties: false, properties, required,
});
const organization = { organization_id: id };
const definitions: DiscoveredTool[] = [
  {
    slug: 'FOUNDRY_ZOHO_LIST_TAXES', toolkit: 'zoho_books', readOnly: true,
    description: 'Read actual configured Zoho Books tax IDs and percentages. Missing taxes must be resolved explicitly; do not invent tax IDs.',
    schema: schema(organization, ['organization_id']),
  },
  {
    slug: 'FOUNDRY_ZOHO_LIST_CURRENCIES', toolkit: 'zoho_books', readOnly: true,
    description: 'Read Zoho Books currency IDs and codes before matching or creating a customer.',
    schema: schema(organization, ['organization_id']),
  },
  {
    slug: 'FOUNDRY_ZOHO_CREATE_CUSTOMER', toolkit: 'zoho_books', readOnly: false,
    description: 'Create a customer only after user authorization. Requires supplied billing address and an existing currency ID. Does not enable the portal or send email. Check existing contacts first; never invent missing addresses.',
    schema: schema({ ...organization, contact_name: text, currency_id: id,
      billing_address: schema({ address: text, city: text, state: text, zip: text, country: text }, ['address']),
      notes: { type: 'string', maxLength: 2000 },
    }, ['organization_id', 'contact_name', 'currency_id', 'billing_address']),
  },
  {
    slug: 'FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE', toolkit: 'zoho_books', readOnly: false,
      description: 'Create a real unsent draft invoice in Zoho Books after approval, disable payment reminders, then retrieve and verify draft status, currency, customer and totals. Requires actual customer/tax IDs. Checks an exact stable reference first to avoid duplicate invoices. No email, sending or payments.',
    schema: schema({ ...organization, customer_id: id, reference_number: text,
      currency_code: { type: 'string', pattern: '^[A-Z]{3}$' },
      expected_total: amount, expected_tax_total: amount,
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      notes: { type: 'string', maxLength: 2000 },
      line_items: { type: 'array', minItems: 1, maxItems: 100, items: schema({
        name: text, description: { type: 'string', maxLength: 2000 },
        rate: amount, quantity: { type: 'number', exclusiveMinimum: 0 },
        discount: { type: 'string', pattern: '^\\d+(\\.\\d+)?%?$' }, tax_id: id,
      }, ['name', 'rate', 'quantity']) },
    }, ['organization_id', 'customer_id', 'reference_number', 'currency_code', 'expected_total', 'expected_tax_total', 'line_items']),
  },
  {
    slug: 'FOUNDRY_ZOHO_GET_INVOICE', toolkit: 'zoho_books', readOnly: true,
    description: 'Retrieve a real Zoho invoice by ID to verify its actual status and totals.',
    schema: schema({ ...organization, invoice_id: id }, ['organization_id', 'invoice_id']),
  },
];
export function zohoTools(connected?: boolean): DiscoveredTool[] {
  return definitions.map(t => ({ ...structuredClone(t), connected }));
}
export function isZohoTool(slug: string) {
  return definitions.some(t => t.slug === slug);
}
type Request = <T>(path: string, body?: unknown) => Promise<T>;
type ZohoData = { code?: number; message?: string; [key: string]: any };
export async function executeZohoTool(request: Request, session: string, slug: string, input: unknown) {
  const definition = definitions.find(t => t.slug === slug);
  if (!definition || !new Validator(definition.schema).validate(input).valid)
    throw new Error('Invalid arguments for the approved Zoho capability');
  const args = input as Record<string, any>;
  const proxy = async (path: string, method = 'GET', body?: unknown) => {
    // The currently verified account uses the US API. No caller-controlled host,
    // endpoint, HTTP method or authentication header is exposed to the model.
    const result = await request<{ status: number; data?: ZohoData }>(
      `/tool_router/session/${encodeURIComponent(session)}/proxy_execute`,
      { toolkit_slug: 'zoho_books', endpoint: `https://www.zohoapis.com/books/v3/${path}`,
        method, ...(body ? { body } : {}) },
    );
    if (!result.data || result.status >= 400 || result.data.code !== 0)
      throw new Error(`Zoho HTTP ${result.status}: ${result.data?.message ?? 'Invalid provider response'}`);
    return result.data;
  };
  const query = `organization_id=${encodeURIComponent(args.organization_id)}`;
  if (slug === 'FOUNDRY_ZOHO_LIST_TAXES') return proxy(`settings/taxes?${query}`);
  if (slug === 'FOUNDRY_ZOHO_LIST_CURRENCIES') return proxy(`settings/currencies?${query}`);
  if (slug === 'FOUNDRY_ZOHO_GET_INVOICE') return proxy(`invoices/${args.invoice_id}?${query}`);
  if (slug === 'FOUNDRY_ZOHO_CREATE_CUSTOMER') {
    const found = await proxy(`contacts?${query}&contact_name=${encodeURIComponent(args.contact_name)}`);
    const matches = (found.contacts ?? []).filter((c: any) => c.contact_name === args.contact_name);
    if (matches.length > 1) throw new Error('Ambiguous customer matches; choose the existing contact explicitly');
    if (matches.length === 1) {
      const detail = await proxy(`contacts/${matches[0].contact_id}?${query}`);
      if (String(detail.contact?.currency_id) !== args.currency_id || detail.contact?.billing_address?.address !== args.billing_address.address)
        throw new Error('Existing customer currency or address differs; resolve the mismatch before invoicing');
      return { ...detail, reused: true };
    }
    const { organization_id: _org, ...customer } = args;
    return proxy(`contacts?${query}`, 'POST', { ...customer, contact_type: 'customer', is_portal_enabled: false });
  }
  const verify = (invoice: any) => {
    if (!invoice?.invoice_id || invoice.status !== 'draft' || invoice.is_emailed !== false || invoice.payment_reminder_enabled !== false ||
      String(invoice.customer_id) !== args.customer_id || invoice.currency_code !== args.currency_code ||
      Math.abs(Number(invoice.total) - args.expected_total) > 0.005 ||
      Math.abs(Number(invoice.tax_total) - args.expected_tax_total) > 0.005 ||
      !Number.isFinite(Number(invoice.total)) || !Number.isFinite(Number(invoice.tax_total)))
      throw new Error('Invoice exists but its draft status, customer, currency or totals did not verify. Reconcile before retrying.');
    if (!Array.isArray(invoice.line_items) || invoice.line_items.length !== args.line_items.length ||
      args.line_items.some((line: any, index: number) => {
        const actual = invoice.line_items[index];
        return actual.name !== line.name || Number(actual.quantity) !== line.quantity ||
          Math.abs(Number(actual.rate) - line.rate) > 0.000001 ||
          (line.tax_id && String(actual.tax_id) !== line.tax_id);
      })) throw new Error('Invoice line items did not match the reviewed payload. Reconcile before retrying.');
    // Keep the verified receipt parseable within the runtime trace limit.
    return { invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_id, customer_name: invoice.customer_name,
      status: invoice.status, is_emailed: invoice.is_emailed, payment_reminder_enabled: invoice.payment_reminder_enabled,
      currency_code: invoice.currency_code, total: invoice.total, tax_total: invoice.tax_total,
      reference_number: invoice.reference_number, line_count: invoice.line_items.length };
  };
  const existing = await proxy(`invoices?${query}&reference_number=${encodeURIComponent(args.reference_number)}`);
  const matches = (existing.invoices ?? []).filter((i: any) => i.reference_number === args.reference_number);
  if (matches.length > 1) throw new Error('Multiple invoices share this source reference; reconcile before creating another');
  if (matches.length) {
    const result = await proxy(`invoices/${matches[0].invoice_id}?${query}`);
    return { invoice: verify(result.invoice), verified: true, reused: true };
  }
  const { organization_id: _org, currency_code: _currency, expected_total: _total, expected_tax_total: _tax, ...payload } = args;
  const created = await proxy(`invoices?${query}&send=false`, 'POST', {
    ...payload, status: 'draft', is_discount_before_tax: true, discount_type: 'item_level', is_inclusive_tax: false,
  });
  if (!created.invoice?.invoice_id) throw new Error('Zoho did not return an invoice ID; reconcile before retrying');
  await proxy(`invoices/${created.invoice.invoice_id}/paymentreminder/disable?${query}`, 'POST');
  const result = await proxy(`invoices/${created.invoice.invoice_id}?${query}`);
  return { invoice: verify(result.invoice), verified: true, reused: false };
}

/** Read/list calls and prose about simulated invoices cannot prove delivery. */
export function verifiedZohoDrafts(attempt: Attempt) {
  const invoices = new Map<string, { id: string; number: string; currency: string; total: number }>();
  for (const t of attempt.traces) {
    if (t.kind !== 'tool' || t.error || t.name !== 'FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE') continue;
    try {
      const data = JSON.parse(t.output);
      const invoice = data.invoice;
      if (data.verified === true && invoice?.invoice_id && invoice.status === 'draft' && invoice.is_emailed === false)
        invoices.set(String(invoice.invoice_id), { id: String(invoice.invoice_id), number: invoice.invoice_number ?? '', currency: invoice.currency_code ?? '', total: Number(invoice.total) });
    } catch { /* Malformed/truncated output is not delivery evidence. */ }
  }
  return [...invoices.values()];
}
export function needsZohoDraftDelivery(attempt: Attempt) {
  return attempt.workflow.nodes.some(n => n.toolkits.includes('zoho_books')) &&
    /(?:creat\w*|execut\w*)[\s\S]{0,100}(?:draft[\s\S]{0,30}invoice|invoice[\s\S]{0,30}draft)/i.test(
      attempt.workflow.title + '\n' + attempt.workflow.nodes.map(n => n.instruction).join('\n'),
    );
}
export function deliveryEvaluation(attempt: Attempt) {
  if (!attempt.evaluation || !needsZohoDraftDelivery(attempt) || verifiedZohoDrafts(attempt).length)
    return attempt.evaluation;
  return { ...attempt.evaluation, score: 0, verdict: 'blocked' as const,
    summary: 'No invoices were created in Zoho Books. The recorded judge score covered preparation or simulation, not live invoice creation.' };
}
