import { CONTRACTS, validateContract } from '@/lib/engine/contracts';
import { appendEvent, newExperiment } from '@/lib/engine/optimizer';
import { createProvider } from '@/lib/server/provider';
import { authorize, failure, HttpError, json, readJson } from '@/lib/server/security';
import { insertExperiment, listExperiments, publicExperiment } from '@/lib/server/store';
export async function GET(request:Request){try{return json({experiments:await listExperiments(await authorize(request))});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const owner=await authorize(request,true);const b=await readJson(request);const mode=b.mode??'reference';if(!['reference','model'].includes(mode))throw new HttpError(400,'Invalid execution mode');if(mode==='model'&&!createProvider())throw new HttpError(422,'Configure the matching GEMINI_API_KEY or OPENAI_API_KEY and FOUNDRY_MODEL on the server before using model-backed search');
 const raw=b.contract??CONTRACTS.find(c=>c.id===b.contractId);let contract;try{contract=validateContract(raw);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid task contract');}
 if(b.goal!==undefined){if(typeof b.goal!=='string'||b.goal.trim().length<10||b.goal.length>8000)throw new HttpError(400,'Goal must contain 10–8000 characters');contract.goal=b.goal.trim();}
 const name=typeof b.name==='string'?b.name.trim():contract.name;if(!name||name.length>120)throw new HttpError(400,'Experiment name must contain 1–120 characters');
 const iterations=b.iterations??5,repeats=b.repeats??3,qualityFloor=b.qualityFloor??1,maxToolCalls=b.maxToolCalls??8,tokenBudget=b.tokenBudget??50000;
 if(!Number.isInteger(iterations)||iterations<2||iterations>12||!Number.isInteger(repeats)||repeats<1||repeats>5||!Number.isFinite(qualityFloor)||qualityFloor<0.5||qualityFloor>1||!Number.isInteger(maxToolCalls)||maxToolCalls<1||maxToolCalls>12||!Number.isInteger(tokenBudget)||tokenBudget<4000||tokenBudget>500000)throw new HttpError(400,'Experiment limits are outside supported bounds');
 const e=newExperiment(crypto.randomUUID(),{name,mode,contract,iterations,repeats,qualityFloor,maxToolCalls,tokenBudget});await appendEvent(e,'created',`Created ${mode} experiment. Test cases remain outside optimizer access.`);await insertExperiment(e,owner);return json(publicExperiment(e),201);
 }catch(e){return failure(e);}}
