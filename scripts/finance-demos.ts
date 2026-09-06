/** Real model runs over synthetic, account-free finance fixtures. Local output only. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createChat, design, startRun, announceTest } from '../lib/workbench/engine.ts';
import { advanceResilient } from '../lib/workbench/recovery.ts';
import { geminiModel } from '../lib/workbench/model.ts';
import { runMetrics } from '../lib/workbench/metrics.ts';
import type { Run } from '../lib/workbench/types.ts';
const fixtures = JSON.parse(readFileSync('lib/workbench/finance-demos.json','utf8'));
const vars = Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').filter(x=>x.includes('=')&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const deps = {model:geminiModel({key:vars.GEMINI_API_KEY,model:vars.FOUNDRY_MODEL||'gemini-3.8-flash',inputPrice:vars.FOUNDRY_INPUT_PRICE_PER_MILLION,outputPrice:vars.FOUNDRY_OUTPUT_PRICE_PER_MILLION}),tools:null};
mkdirSync('outputs/finance-demos',{recursive:true});
for(const fixture of fixtures) {
  const path=`outputs/finance-demos/${fixture.id}-runs.json`;
  let prior;
  if(process.argv.includes('--repair')) {
    const evidence=JSON.parse(readFileSync(`outputs/finance-demos/${fixture.id}-evidence.json`,'utf8'));
    if(evidence.review.passed) continue;
    prior=JSON.parse(readFileSync(path,'utf8'));
    writeFileSync(`outputs/finance-demos/${fixture.id}-before-repair-evidence.json`,JSON.stringify(evidence,null,2));
  }
  if(process.argv.includes('--resume')) { try { const prior=JSON.parse(readFileSync(path,'utf8')); if(prior.finished) {console.log(`${fixture.id}: already finished`);continue;} } catch {} }
  let chat=await design(prior?.chat ?? createChat(crypto.randomUUID()),prior ? 'The independent fixture review found missing reporting fields. Improve this workflow and its test criteria: show aggregate eligible invoice totals separately for each currency, and state the held amount and currency for each exception. Preserve every line, customer identity, billing details and arithmetic. Apply these general rules to future inputs; do not hardcode the demo values. Keep at most 3 agents and use no external apps.' : fixture.prompt+' Keep the workflow to at most 3 agents.',deps,[]);
  chat.title=fixture.title;
  chat.settings.maxIterations=3;
  const runs:Run[]=prior?.runs ?? [];
  const save=(finished=false)=>writeFileSync(path,JSON.stringify({chat,runs,finished,fixture:fixture.id},null,2));
  for(const mode of ['test','manual'] as const) {
    let run=await startRun(chat,true,undefined,{mode,input:fixture.input});
    if(mode==='test') {
      announceTest(chat,run);
      chat.messages.push({id:crypto.randomUUID(),role:'assistant',createdAt:new Date().toISOString(),content:`Testing with the synthetic **${fixture.id}.xlsx** workbook. This is a fixed demo fixture; no connected finance accounts are used.`});
    }
    runs.push(run);save();
    for(let step=0;run.status==='running'&&step<70;step++) {
      ({chat,run}=await advanceResilient(chat,run,deps));
      runs[runs.length-1]=run;save();
      console.log(`${fixture.id} ${mode}: ${run.phase}, attempt ${run.attempts.length}, ${run.status}`);
    }
    if(run.status==='running') {run.status='failed';run.error='Demo runner reached its step limit.';runs[runs.length-1]=run;}
    const final=run.attempts.at(-1)!;
    const output=final.states.filter(s=>!final.workflow.nodes.some(n=>n.dependsOn.includes(s.nodeId))).map(s=>s.output).join('\n\n');
    writeFileSync(`outputs/finance-demos/${fixture.id}-${mode}.md`,output);
    if(mode==='test') {
      const result=await deps.model.json<{passed:boolean;findings:string[]}>(
        'Independently verify a finance demo output against the supplied expected facts. Do not give partial credit for a number appearing with the wrong meaning. Check every expected fact. Return passed only if all are correct. This is an output review, not a financial recommendation.',
        {expected:fixture.expected,output},
        {type:'object',properties:{passed:{type:'boolean'},findings:{type:'array',items:{type:'string'}}},required:['passed','findings'],additionalProperties:false},
      );
      chat.messages.push({id:crypto.randomUUID(),role:'assistant',createdAt:new Date().toISOString(),content:`**Independent fixture review: ${result.value.passed?'passed':'needs attention'}**\n\n${result.value.findings.map(f=>'- '+f).join('\n')}\n\nCompared with hand-calculated expected results. This is a separate model review of one synthetic workbook, not a measured production accuracy rate.`});
      writeFileSync(`outputs/finance-demos/${fixture.id}-evidence.json`,JSON.stringify({fixture:fixture.id,expected:fixture.expected,metrics:runMetrics(run),review:result.value,reviewUsage:result.usage},null,2));
    }
    save();
  }
  save(true);
}
