import type { Architecture, AuditEvent, Candidate, Experiment, ExperimentConfig, ModelProvider, ToolId, ToolNode, Usage } from './types.ts';
import { canonical, digest, evaluate, validateArchitecture } from './runtime.ts';
export const ENGINE_VERSION='0.1.0';
const noUsage=():Usage=>({inputTokens:0,outputTokens:0,costUsd:0,model:null});
export function newExperiment(id:string,config:ExperimentConfig):Experiment{const now=new Date().toISOString();return{id,config:structuredClone(config),createdAt:now,updatedAt:now,revision:0,status:'ready',phase:'Generate baseline',candidates:[],selectedId:null,sealed:null,events:[],error:null,usage:noUsage()};}
export async function appendEvent(e:Experiment,type:string,detail:string){const event:Omit<AuditEvent,'hash'>={sequence:e.events.length+1,type,detail,at:new Date().toISOString(),previousHash:e.events.at(-1)?.hash??'genesis'};e.events.push({...event,hash:await digest(event)});}
export async function verifyAudit(events:AuditEvent[]){let previous='genesis';for(let i=0;i<events.length;i++){const {hash,...event}=events[i];if(event.sequence!==i+1||event.previousHash!==previous||await digest(event)!==hash)return false;previous=hash;}return true;}
const configs:Partial<Record<ToolId,ToolNode['config'][]>>={filter_records:[{field:'status',value:'paid'}],sort_jobs:[{by:'deadline',direction:'asc'},{by:'duration',direction:'asc'},{by:'value',direction:'desc'}],allocate_jobs:[{respectDeadlines:true},{respectDeadlines:false}],resolve_request:[{requirePolicy:true,idempotent:false},{requirePolicy:true,idempotent:true},{requirePolicy:false,idempotent:true}],sum_records:[{field:'amount'}],deduplicate_records:[{key:'id'}]};
const reindex=(nodes:ToolNode[])=>nodes.map((n,i)=>({...n,id:`step_${i+1}`}));
export function baselineArchitecture(tools:ToolId[]):Architecture{const tool=tools.at(-1)!;return{name:'Initial architecture',hypothesis:'Minimal direct execution establishes a reference. This is a fixed tool baseline, not a language-model baseline.',nodes:[{id:'step_1',tool,config:configs[tool]?.[0]??{}}]};}
function structuralKey(a:Architecture){return canonical(a.nodes.map(n=>({tool:n.tool,config:n.config})));}
async function referenceProposal(e:Experiment):Promise<Architecture>{
 const current=e.candidates.find(c=>c.id===e.selectedId)?.architecture??baselineArchitecture(e.config.contract.tools);
 const variants:Architecture[]=[];const known=new Set(e.candidates.map(c=>structuralKey(c.architecture)));
 const add=(nodes:ToolNode[],hypothesis:string)=>{if(!nodes.length||nodes.length>e.config.maxToolCalls)return;const a={name:`Candidate ${e.candidates.length+1}`,hypothesis,nodes:reindex(nodes)};const key=structuralKey(a);if(!known.has(key)){known.add(key);variants.push(a);}};
 const parents=[current,...e.candidates.slice(-2).map(c=>c.architecture)];
 for(const parent of parents){
 for(const tool of e.config.contract.tools){if(tool==='identity')continue;for(const config of configs[tool]??[{}]){
  for(let i=0;i<=parent.nodes.length;i++){if(parent.nodes.some(n=>n.tool===tool))continue;add([...parent.nodes.slice(0,i),{id:'new',tool,config},...parent.nodes.slice(i)],`Test inserting ${tool} at position ${i+1}.`);}
  parent.nodes.forEach((n,i)=>{if(n.tool===tool)add(parent.nodes.map((node,j)=>j===i?{...node,config}:node),`Test an alternative configuration for ${tool}.`);});
 }}
 parent.nodes.forEach((_,i)=>add(parent.nodes.filter((__,j)=>i!==j),'Test whether removing a step preserves quality with fewer tool calls.'));
 }
 let winner:Architecture|null=null;let score=-Infinity;
 for(const a of variants.slice(0,96)){
  const result=await evaluate(a,e.config.contract.development,1,e.config.maxToolCalls);
  const failureCount=result.results.reduce((n,r)=>n+r.failures.length,0);
  const value=result.accuracy*10000-failureCount*10-a.nodes.length;
  if(value>score){score=value;winner=a;}
 }
 return winner??{...current,name:`Candidate ${e.candidates.length+1}`,hypothesis:'No untested local mutation remains. Re-evaluate the incumbent; no improvement is assumed.'};
}
export function selectionReason(candidate:Candidate,incumbent:Candidate,qualityFloor:number):{accepted:boolean;reason:string}{
 const a=candidate.validation,b=incumbent.validation;
 if(a.accuracy<b.accuracy||a.reliability<b.reliability)return{accepted:false,reason:'Rejected: validation accuracy or repeated-run reliability regressed.'};
 if(a.accuracy>b.accuracy||a.reliability>b.reliability)return{accepted:true,reason:`Accepted: validation quality improved${a.accuracy<qualityFloor?'; release quality target is not yet met':''}.`};
 if(a.meanToolCalls<b.meanToolCalls)return{accepted:true,reason:'Accepted: equal validation quality with fewer tool calls.'};
 return{accepted:false,reason:'Rejected: no measured quality improvement or reduction in tool calls.'};
}
export async function advanceExperiment(original:Experiment,provider?:ModelProvider):Promise<Experiment>{
 const e=structuredClone(original);
 if(['completed','failed','cancelled'].includes(e.status))throw new Error('Experiment is not runnable');
 e.status='running';e.error=null;
 if(e.candidates.length>=e.config.iterations){
  e.phase='Sealed evaluation';const base=e.candidates[0],selected=e.candidates.find(c=>c.id===e.selectedId)!;
  // No model or proposer receives these fixtures or their results.
  e.sealed={baseline:await evaluate(base.architecture,e.config.contract.test,e.config.repeats,e.config.maxToolCalls),selected:await evaluate(selected.architecture,e.config.contract.test,e.config.repeats,e.config.maxToolCalls)};
  e.status='completed';e.phase='Completed';await appendEvent(e,'sealed_evaluation',`Selected ${selected.id} before opening test cases. Test success: ${e.sealed.selected.accuracy}.`);
 }else{
  const generation=e.candidates.length;let architecture:Architecture;let usage=noUsage();
  if(e.config.mode==='model'){
   if(!provider)throw new Error('Model provider is not configured. Set server-side model credentials or use reference search.');
   const remaining=e.config.tokenBudget-e.usage.inputTokens-e.usage.outputTokens;
   if(remaining<4000)throw new Error('Optimization token budget exhausted');
   const incumbent=e.candidates.find(c=>c.id===e.selectedId);
   const failures=(incumbent?.development.results??[]).filter(r=>!r.passed&&r.repeat===0).slice(0,4).map(r=>({caseId:r.caseId,input:e.config.contract.development.find(f=>f.id===r.caseId)!.input,failures:r.failures,traces:r.traces}));
   const result=await provider.generate({contract:{goal:e.config.contract.goal,tools:e.config.contract.tools},previous:incumbent?.architecture??null,failures,generation,maxOutputTokens:Math.min(4000,remaining-1500),maxTotalTokens:remaining});
   architecture=validateArchitecture(result.architecture,e.config.contract.tools);usage=result.usage;
   e.usage.inputTokens+=usage.inputTokens;e.usage.outputTokens+=usage.outputTokens;e.usage.costUsd=e.usage.costUsd!==null&&usage.costUsd!==null?e.usage.costUsd+usage.costUsd:null;e.usage.model=usage.model;
   if(e.usage.inputTokens+e.usage.outputTokens>e.config.tokenBudget){e.status='failed';e.phase='Budget exceeded';e.error='Reported token usage exceeded the optimization budget. No candidate was promoted.';await appendEvent(e,'budget_exceeded',e.error);e.updatedAt=new Date().toISOString();return e;}
  }else architecture=generation===0?baselineArchitecture(e.config.contract.tools):await referenceProposal(e);
  architecture=validateArchitecture(architecture,e.config.contract.tools);
  const c:Candidate={id:`v${generation+1}`,generation,architecture,digest:await digest(architecture),development:await evaluate(architecture,e.config.contract.development,e.config.repeats,e.config.maxToolCalls),validation:await evaluate(architecture,e.config.contract.validation,e.config.repeats,e.config.maxToolCalls),decision:'baseline',reason:'Initial reference candidate.',usage};
  const incumbent=e.candidates.find(x=>x.id===e.selectedId);
  if(incumbent){const decision=selectionReason(c,incumbent,e.config.qualityFloor);c.decision=decision.accepted?'accepted':'rejected';c.reason=decision.reason;if(decision.accepted)e.selectedId=c.id;}else e.selectedId=c.id;
  e.candidates.push(c);e.phase=e.candidates.length>=e.config.iterations?'Ready for sealed evaluation':`Candidate ${e.candidates.length+1} of ${e.config.iterations}`;
  await appendEvent(e,'candidate_evaluated',`${c.id} ${c.decision}: ${c.reason} Architecture SHA-256 ${c.digest}.`);
 }
 e.updatedAt=new Date().toISOString();return e;
}
export function promotionBlockers(e:Experiment):string[]{
 const blockers:string[]=[];
 if(e.status!=='completed'||!e.sealed)blockers.push('Complete sealed evaluation before promotion');
 if(e.sealed){if(e.sealed.selected.accuracy<e.config.qualityFloor)blockers.push('Sealed accuracy is below the quality target');if(e.sealed.selected.reliability<e.config.qualityFloor)blockers.push('Sealed reliability is below the quality target');if(e.sealed.selected.accuracy<e.sealed.baseline.accuracy)blockers.push('Sealed accuracy regressed against the baseline');}
 return blockers;
}
