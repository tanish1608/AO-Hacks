import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRules, workflowState, type WorkflowRow } from '../lib/workbench/workspace.ts';
import { createChat, startRun, advanceChatRun } from '../lib/workbench/engine.ts';
import { emptyUsage, type Workflow, type Dependencies } from '../lib/workbench/types.ts';
import { runtimePolicy } from '../server/runtime-policy.mjs';
import { sanitizeToolClaim, taskCorpus } from '../lib/workbench/redaction.ts';
const row: WorkflowRow = { id:'w',title:'Orders',updated_at:'2026-09-26',steps:1,latestRun:null };
const workflow: Workflow = { title:'Summarize notes',explanation:'Extract notes into a summary.',nodes:[{id:'writer',name:'Writer',role:'Summarize',instruction:'Summarize the input.',toolkits:[],dependsOn:[]}],criteria:[{id:'facts',name:'Facts',description:'Only source facts',weight:1,required:true},{id:'format',name:'Format',description:'A summary',weight:1,required:true}] };
function chat() { const c=createChat('w');c.versions=[{id:'v',createdAt:'now',workflow,digest:'g',reason:'test'}];return c; }
void test('workspace distinguishes test completion from a real run and prioritizes uncertain writes',()=>{
  const last: NonNullable<WorkflowRow['latestRun']>={id:'r',status:'completed',mode:'test',error:null,updatedAt:'now',pendingStatus:null};
  assert.equal(workflowState({...row,latestRun:last}).label,'Test completed');
  assert.equal(workflowState({...row,latestRun:{...last,mode:'manual'}}).label,'Run completed');
  assert.equal(workflowState({...row,latestRun:{...last,pendingStatus:'unknown'}}).group,'attention');
  assert.equal(workflowState({...row,latestRun:{...last,status:'paused'}}).label,'Paused');
});
void test('rules are bounded, trimmed, deduplicated, and copied into each run',async()=>{
  assert.deepEqual(cleanRules([' Keep facts ','Keep facts']),['Keep facts']);
  for(const invalid of [null,[''],[123],Array(21).fill('rule'),['x'.repeat(1001)]]) assert.throws(()=>cleanRules(invalid));
  const c=chat();c.rules=['Keep facts'];const run=await startRun(c);c.rules[0]='Changed';assert.deepEqual(run.rules,['Keep facts']);
});
void test('preflight blocks before test generation without using tokens or invoking tools',async()=>{
  const c=chat();const run=await startRun(c,true,undefined,{generateInput:true});
  const deps: Dependencies={model:{async json(){throw Error('Model must not run');}},tools:null,preflight:async()=> 'Connect Zoho Books first.'};
  const result=await advanceChatRun(c,run,deps);
  assert.equal(result.run.status,'blocked');assert.equal(result.run.phase,'done');assert.equal(result.run.usage.inputTokens,0);
  assert.equal(result.run.attempts[0].traces.length,0);assert.match(result.chat.messages.at(-1)!.content,/No model calls/);
});
void test('missing input exits without paying for a judge or repair loop',async()=>{
  const c=chat(),run=await startRun(c);run.phase='evaluate';Object.assign(run.attempts[0].states[0],{status:'blocked',blockReason:'input',error:'Provide a source document.'});
  const result=await advanceChatRun(c,run,{model:{async json(){throw Error('Judge must not run');}},tools:null});
  assert.equal(result.run.status,'blocked');assert.equal(result.run.error,'Provide a source document.');assert.equal(result.run.attempts[0].evaluation,null);
});
void test('execution receives frozen workflow rules, not a later edit',async()=>{
  const c=chat();c.rules=['Mark missing dates unspecified'];const run=await startRun(c,true,undefined,{mode:'manual',input:'Notes'});c.rules=['New rule'];
  const deps: Dependencies={model:{async json<T>(_system:string,input:unknown){assert.deepEqual((input as {approvedBusinessRules:string[]}).approvedBusinessRules,['Mark missing dates unspecified']);return{value:{action:'finish',output:'Date: unspecified',toolSlug:'',argumentsJson:'{}',reason:''} as T,usage:emptyUsage(),durationMs:1};}},tools:null};
  const result=await advanceChatRun(c,run,deps);assert.equal(result.run.attempts[0].states[0].status,'done');
});
void test('standalone runtime rejects public header trust and shared open identity',()=>{
  assert.equal(runtimePolicy({}).host,'127.0.0.1');
  assert.throws(()=>runtimePolicy({AUTH_MODE:'open'}),/no longer supported/);
  assert.throws(()=>runtimePolicy({AUTH_MODE:'sites',HOST:'0.0.0.0'}),/cannot trust/);
  assert.throws(()=>runtimePolicy({AUTH_MODE:'iap'}),/IAP_AUDIENCE/);
  assert.equal(runtimePolicy({AUTH_MODE:'iap',IAP_AUDIENCE:'/projects/test'}).host,'0.0.0.0');
});
void test('business rules are included in the cross-workflow leakage filter',async()=>{
  const c=chat();c.rules=['Zoho Books: customer special billing terms require a purchase order'];
  const run=await startRun(c);c.rules=[];
  const corpus=taskCorpus(c,run,run.attempts[0]);
  assert.equal(sanitizeToolClaim('zoho_books special billing terms require a purchase order',corpus,['zoho_books']),null);
});
