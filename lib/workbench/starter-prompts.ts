/** Home-screen instructions are separate from the fixed evaluation fixtures. */
export const zohoInvoiceStarter = {
  title: 'Orders to Zoho invoice drafts',
  apps: ['zoho_books'],
  prompt: `Build a workflow that reads uploaded Excel Orders and Customers tables, validates them, and creates draft invoices in my connected Zoho Books organization. Use Zoho Books as the only external application.

Connection and capability checks:
- If Zoho Books is disconnected, prompt me to connect it in chat.
- Identify the target organization; ask me to choose if multiple are available.
- Verify that the available tools support creating invoices directly. If unsupported, explain the missing capability and preserve the prepared drafts. Do not invent tool names or create sales orders as a workaround.

Prepare the invoices:
- Deduplicate identical rows with the same order-line ID.
- Treat duplicate IDs with conflicting values as exceptions; exclude all conflicting versions until resolved.
- Group eligible lines by customer AND currency.
- Hold customers missing billing addresses.
- Match spreadsheet customers to actual Zoho customer records. If a customer is missing, prepare creation from the supplied name, billing address and currency, and request approval in chat before creating it. Hold ambiguous matches and missing addresses. Do not modify existing customers silently. Spreadsheet IDs such as C1 are not Zoho record IDs.
- Validate currency compatibility and map supplied tax rates to appropriate existing Zoho tax records. Flag missing or ambiguous mappings.
- Apply each line's discount before calculating tax. Use the currency's precision and verify Zoho's rounding.
- Show every eligible line, subtotal, tax, invoice total, currency-level totals, and an exception register with held amounts and reasons.

Test before writing:
- Run synthetic tests without creating records in Zoho. Label simulated results clearly; never claim that a dry run verified live invoice creation.
- Test duplicates, conflicting IDs, missing addresses, mixed currencies, discounts, and tax calculations.
- Use executable numeric assertions where available. Clearly distinguish arithmetic verification from model judgment or literal number-presence checks.
- Show results and bounded repair attempts in chat.

Create after review:
- Present the proposed invoice payloads for my approval.
- Create only approved invoices and keep them in draft status.
- Never email, mark as sent, record payment, or enable reminders.
- Use a stable source reference and check existing records to prevent duplicate creation on reruns. If a write has an uncertain outcome, reconcile it before retrying.
- After creation, retrieve each invoice and verify its draft status, customer, currency, lines, and totals.
- Return invoice IDs, verified links where available, and unresolved exceptions. Report partial failures honestly.`,
};
