import type { Architecture, Assertion, CaseResult, Evaluation, Fixture, Json, ToolId, Trace } from './types.ts';
export const TOOL_CATALOG: Record<ToolId, { description: string; config: string }> = {
 identity: { description: 'Copy state unchanged. Useful as a reference baseline.', config: '{}' },
 normalize_records: { description: 'Normalize records: strip currency punctuation and parse amount to number; lowercase and trim status; trim id.', config: '{}' },
 deduplicate_records: { description: 'Keep the first record per id, or a configured key. Preserve rows missing the key.', config: '{key?: string}' },
 filter_records: { description: 'Keep records where a field exactly matches a supplied value.', config: '{field: string, value: JSON}' },
 sum_records: { description: 'Sum numeric amounts into total and count. Does not parse string amounts.', config: '{field?: string}' },
 sort_jobs: { description: 'Sort jobs by deadline, duration, or value.', config: '{by: "deadline" | "duration" | "value", direction?: "asc" | "desc"}' },
 allocate_jobs: { description: 'Sequentially schedule jobs from time zero within capacity. Optional deadline checks skip jobs that would be late. Produces schedule, completed and value.', config: '{respectDeadlines?: boolean}' },
 check_policy: { description: 'Read request and policy. Set eligible from ageDays <= refundWindowDays, amount <= maxAmount, and status == paid. Record reason.', config: '{}' },
 resolve_request: { description: 'Resolve request as refund or review. Can require policy eligibility and avoid a refund already recorded in priorOperations.', config: '{requirePolicy?: boolean, idempotent?: boolean}' },
};
export function canonical(value: unknown): string {
 if (value === null || typeof value !== 'object') return JSON.stringify(value);
 if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
 return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
}
export async function digest(value: unknown): Promise<string> {
 const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));
 return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
function record(value: Json | undefined): Record<string, Json> {
 if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected an object');
 return value;
}
function rows(value: Json | undefined): Record<string, Json>[] {
 if (!Array.isArray(value) || value.length > 200) throw new Error('Expected at most 200 records');
 return value.map(record);
}
function numeric(v: Json | undefined): number { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Expected a finite number'); return v; }
function path(root: Json, key: string): Json | undefined {
 let current: Json | undefined = root;
 for (const part of key.split('.')) {
  if (['__proto__','prototype','constructor'].includes(part)) return undefined;
  if (current === null || typeof current !== 'object' || !Object.hasOwn(current,part)) return undefined;
  current = (current as Record<string, Json>)[part];
 }
 return current;
}
export function validateArchitecture(input: unknown, allowed: ToolId[]): Architecture {
 if (!input || typeof input!=='object') throw new Error('Architecture must be an object');
 const a=input as Architecture;
 if (typeof a.name!=='string' || !a.name.trim() || a.name.length>120 || typeof a.hypothesis!=='string' || a.hypothesis.length>2000 || !Array.isArray(a.nodes) || !a.nodes.length || a.nodes.length>12) throw new Error('Invalid architecture shape');
 const ids=new Set<string>();
 for(const n of a.nodes){
  if(!n || typeof n.id!=='string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(n.id) || ids.has(n.id)) throw new Error('Node IDs must be unique safe identifiers');
  ids.add(n.id);
  if(!Object.hasOwn(TOOL_CATALOG,n.tool) || !allowed.includes(n.tool)) throw new Error('Architecture requested a tool outside its capability allowlist');
  if(!n.config || Array.isArray(n.config) || typeof n.config!=='object' || canonical(n.config).length>2000) throw new Error('Invalid tool configuration');
 }
 return structuredClone(a);
}
export function executeTool(tool: ToolId, state: Record<string, Json>, config: Record<string, Json>): Record<string, Json> {
 const s=structuredClone(state);
 switch(tool){
  case 'identity':return s;
  case 'normalize_records':s.records=rows(s.records).map(r=>({...r,id:typeof r.id==='string'?r.id.trim():r.id??null,status:typeof r.status==='string'?r.status.trim().toLowerCase():r.status??null,amount:typeof r.amount==='string'?Number(r.amount.replace(/[$,\s]/g,'')):r.amount??null}));if(rows(s.records).some(r=>!Number.isFinite(r.amount)))throw new Error('Unparseable amount');return s;
  case 'deduplicate_records':{const seen=new Set<string>();const key=(typeof config.key==='string'?config.key:'id');s.records=rows(s.records).filter(r=>{if(r[key]===undefined||r[key]===null||r[key]==='')return true;const k=canonical(r[key]);if(seen.has(k))return false;seen.add(k);return true;});return s;}
  case 'filter_records':if(typeof config.field!=='string'||!Object.hasOwn(config,'value'))throw new Error('Filter needs field and value');s.records=rows(s.records).filter(r=>canonical(r[(typeof config.field==='string'?config.field:'')]??null)===canonical(config.value));return s;
  case 'sum_records':s.total=rows(s.records).reduce((sum,r)=>sum+numeric(r[(typeof config.field==='string'?config.field:'amount')]),0);s.count=rows(s.records).length;return s;
  case 'sort_jobs':{const key=(typeof config.by==='string'?config.by:'deadline');if(!['deadline','duration','value'].includes(key))throw new Error('Invalid job sort key');s.jobs=rows(s.jobs).sort((a,b)=>(numeric(a[key])-numeric(b[key]))*(config.direction==='desc'?-1:1));return s;}
  case 'allocate_jobs':{let time=0,value=0;const schedule:Json[]=[];for(const job of rows(s.jobs)){const duration=numeric(job.duration);if(duration<=0)throw new Error('Duration must be positive');const finish=time+duration;if(finish>numeric(s.capacity))continue;if(config.respectDeadlines&&finish>numeric(job.deadline))continue;schedule.push({id:job.id,start:time,finish});time=finish;value+=numeric(job.value);}s.schedule=schedule;s.completed=schedule.length;s.value=value;return s;}
  case 'check_policy':{const r=record(s.request),p=record(s.policy);s.eligible=numeric(r.ageDays)<=numeric(p.refundWindowDays)&&numeric(r.amount)<=numeric(p.maxAmount)&&r.status==='paid';s.reason=s.eligible?'Within supplied policy':'Requires human review';return s;}
  case 'resolve_request':{const r=record(s.request);const prior=Array.isArray(s.priorOperations)?s.priorOperations:[];const existing=prior.some(o=>record(o).requestId===r.id);const permitted=!config.requirePolicy||s.eligible===true;s.action=permitted?(config.idempotent&&existing?'already_resolved':'refund'):'review';s.refundsCreated=s.action==='refund'?1:0;s.totalRefunds=prior.filter(o=>record(o).requestId===r.id).length+Number(s.refundsCreated);return s;}
  default:throw new Error('Unknown tool');
 }
}
export function evaluateAssertion(state: Record<string, Json>, a: Assertion): string | null {
 const actual=path(state,a.path);let pass=false;
 switch(a.operator){case 'equals':pass=actual!==undefined&&canonical(actual)===canonical(a.value);break;case 'lte':pass=typeof actual==='number'&&typeof a.value==='number'&&actual<=a.value;break;case 'gte':pass=typeof actual==='number'&&typeof a.value==='number'&&actual>=a.value;break;case 'length':pass=Array.isArray(actual)&&actual.length===a.value;break;}
 return pass?null:`${a.path}: expected ${a.operator} ${JSON.stringify(a.value)}, received ${JSON.stringify(actual)??'missing'}`;
}
export async function runCase(architecture: Architecture, fixture: Fixture, repeat: number, maxToolCalls: number): Promise<CaseResult>{
 let state=structuredClone(fixture.input);const traces:Trace[]=[];const failures:string[]=[];const started=performance.now();
 for(const n of architecture.nodes){
  if(traces.length>=maxToolCalls){failures.push('Tool-call budget exhausted');break;}
  const inputHash=await digest(state);const t=performance.now();
  try{state=executeTool(n.tool,state,n.config);traces.push({nodeId:n.id,tool:n.tool,inputHash,output:structuredClone(state),durationMs:performance.now()-t});}
  catch(e){const error=e instanceof Error?e.message:'Tool execution failed';traces.push({nodeId:n.id,tool:n.tool,inputHash,output:null,durationMs:performance.now()-t,error});failures.push(error);break;}
 }
 for(const a of fixture.assertions){const failure=evaluateAssertion(state,a);if(failure)failures.push(failure);}
 return {caseId:fixture.id,repeat,passed:failures.length===0,failures,toolCalls:traces.length,durationMs:performance.now()-started,traces};
}
export async function evaluate(architecture: Architecture, fixtures: Fixture[], repeats: number, maxToolCalls: number): Promise<Evaluation>{
 const results:CaseResult[]=[];
 for(const f of fixtures)for(let repeat=0;repeat<repeats;repeat++)results.push(await runCase(architecture,f,repeat,maxToolCalls));
 const times=results.map(r=>r.durationMs).sort((a,b)=>a-b);
 const reliable=fixtures.filter(f=>results.filter(r=>r.caseId===f.id).every(r=>r.passed)).length;
 return {accuracy:results.filter(r=>r.passed).length/results.length,reliability:reliable/fixtures.length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)],meanToolCalls:results.reduce((n,r)=>n+r.toolCalls,0)/results.length,cases:fixtures.length,executions:results.length,results};
}
