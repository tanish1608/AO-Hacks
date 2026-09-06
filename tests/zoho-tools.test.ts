import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposioGateway } from '../lib/workbench/composio.ts';
import { needsZohoDraftDelivery, verifiedZohoDrafts, zohoTools } from '../lib/workbench/zoho-tools.ts';
import { normalizeEvaluation } from '../lib/workbench/validation.ts';
import { emptyUsage, type Attempt, type Evaluation, type Observation } from '../lib/workbench/types.ts';
const args = {organization_id:'123',customer_id:'456',reference_number:'batch-c1-eur',currency_code:'EUR',expected_total:600,expected_tax_total:0,line_items:[{name:'Translation',quantity:2,rate:300}]};
const invoice = {invoice_id:'789',invoice_number:'INV-1',customer_id:'456',currency_code:'EUR',status:'draft',is_emailed:false,payment_reminder_enabled:false,total:600,tax_total:0,reference_number:args.reference_number,line_items:args.line_items};
function gateway(responses: unknown[], calls: Record<string, any>[]) {
  return new ComposioGateway('test', async (_url, init) => {
    const body=JSON.parse(init!.body as string);calls.push(body);
    return Response.json(responses.shift());
  });
}
void test('Zoho draft creation uses fixed endpoint, never sends, and reads back before verification', async () => {
  const calls: Record<string, any>[]=[];
  const g=gateway([{status:200,data:{code:0,invoices:[]}},{status:201,data:{code:0,invoice}},{status:200,data:{code:0}},{status:200,data:{code:0,invoice}}],calls);
  const result=await g.execute('session','FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE',args) as any;
  assert.equal(result.verified,true);assert.equal(result.invoice.status,'draft');
  assert.equal(calls[1].method,'POST');assert.ok(calls[1].endpoint.endsWith('&send=false'));
  assert.equal(calls[1].body.status,'draft');assert.equal(calls[1].body.expected_total,undefined);
  assert.equal(calls[2].method,'POST');assert.ok(calls[2].endpoint.includes('/paymentreminder/disable?'));
  assert.equal(calls[3].method,'GET');assert.ok(calls[3].endpoint.includes('/invoices/789?'));
});
void test('Zoho mutation rejects extra email or endpoint arguments without dispatch', async () => {
  const calls: Record<string, any>[]=[];const g=gateway([],calls);
  for(const extra of [{send:true},{endpoint:'https://example.com'},{contact_persons:['1']}])
    await assert.rejects(g.execute('s','FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE',{...args,...extra}),/Invalid arguments/);
  assert.equal(calls.length,0);
  assert.equal(zohoTools().find(t=>t.slug==='FOUNDRY_ZOHO_CREATE_CUSTOMER')?.readOnly,false);
});
void test('exact invoice reference is reused without a second mutation',async()=>{
  const calls: Record<string, any>[]=[];
  const g=gateway([{status:200,data:{code:0,invoices:[invoice]}},{status:200,data:{code:0,invoice}}],calls);
  const result=await g.execute('s','FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE',args) as any;
  assert.equal(result.reused,true);assert.ok(calls.every(c=>c.method==='GET'));
});
void test('provider errors and incorrect read-back totals never verify',async()=>{
  const g=gateway([{status:403,data:{code:57,message:'Insufficient scope'}}],[]);
  await assert.rejects(g.execute('s','FOUNDRY_ZOHO_LIST_TAXES',{organization_id:'123'}),/Insufficient scope/);
  const bad=gateway([{status:200,data:{code:0,invoices:[invoice]}},{status:200,data:{code:0,invoice:{...invoice,total:601}}}],[]);
  await assert.rejects(bad.execute('s','FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE',args),/did not verify/);
});
function attempt(tool: Observation): Attempt {
  return {id:'a',iteration:1,workflow:{title:'Create draft invoices in Zoho Books',explanation:'Create drafts',nodes:[{id:'creator',name:'Creator',role:'Create',instruction:'Create draft invoices in Zoho Books.',toolkits:['zoho_books'],dependsOn:[]}],criteria:[{id:'quality',name:'Quality',description:'Complete',weight:1,required:true}]},graphDigest:'g',states:[{nodeId:'creator',status:'done',output:'100 invoices created',turns:1,observations:[],tools:[],error:null}],traces:[tool],evaluation:null,memoryIds:[],startedAt:'now',finishedAt:null};
}
const trace: Observation={id:'t',nodeId:'creator',kind:'tool',name:'ZOHO_BOOKS_LIST_INVOICES',at:'now',durationMs:1,input:'{}',output:'{"invoices":[]}',error:null,usage:emptyUsage(),langsmith:'disabled'};
const raw: Evaluation={score:1,verdict:'pass',summary:'Success',checks:[{criterionId:'quality',score:1,rationale:'Looks good',evidenceIds:['t'],verified:true}],issues:[],memoryVerdicts:[]};
void test('100 percent judge scores plus list calls cannot claim invoice delivery',()=>{
  const a=attempt(trace);assert.equal(needsZohoDraftDelivery(a),true);
  const e=normalizeEvaluation(raw,a.workflow.criteria,a,.85);
  assert.equal(e.score,0);assert.equal(e.verdict,'blocked');assert.match(e.summary,/No verified draft invoices/);
});
void test('verified provider receipt is required; model text and get-only traces do not count',()=>{
  const a=attempt({...trace,name:'FOUNDRY_ZOHO_CREATE_DRAFT_INVOICE',output:JSON.stringify({invoice,verified:true})});
  assert.equal(verifiedZohoDrafts(a).length,1);
  assert.equal(normalizeEvaluation(raw,a.workflow.criteria,a,.85).verdict,'pass');
  a.traces[0].kind='model';assert.equal(verifiedZohoDrafts(a).length,0);
  a.traces[0].kind='tool';a.traces[0].name='FOUNDRY_ZOHO_GET_INVOICE';assert.equal(verifiedZohoDrafts(a).length,0);
});
