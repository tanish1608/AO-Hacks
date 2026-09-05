import { advanceExperiment, appendEvent, ENGINE_VERSION, promotionBlockers, verifyAudit } from '@/lib/engine/optimizer';
import { digest, TOOL_CATALOG } from '@/lib/engine/runtime';
import { createProvider } from '@/lib/server/provider';
import { authorize, failure, HttpError, json, readJson } from '@/lib/server/security';
import { acquireLease, database, loadExperiment, publicExperiment, releaseLease, saveExperiment } from '@/lib/server/store';
export async function POST(request:Request,{params}:{params:Promise<{id:string;action:string}>}){
 let token:string|undefined,owner:string|undefined,id:string|undefined;
 try{owner=await authorize(request,true);const p=await params;id=p.id;const b=await readJson(request);if(!['advance','cancel','promote'].includes(p.action))throw new HttpError(404,'Unknown experiment action');const e=await loadExperiment(id,owner);if(b.revision!==e.revision)throw new HttpError(409,'Experiment changed. Refresh before continuing.');
 token=await acquireLease(id,owner,e.revision);
 if(p.action==='cancel'){if(['completed','cancelled','failed'].includes(e.status))throw new HttpError(409,'Only active experiments can be cancelled');e.status='cancelled';e.phase='Cancelled';e.updatedAt=new Date().toISOString();await appendEvent(e,'cancelled','Cancelled by workspace owner.');await saveExperiment(e,owner,token);return json(publicExperiment(e));}
 if(p.action==='promote'){
  const blockers=promotionBlockers(e);if(blockers.length)throw new HttpError(422,blockers.join('; '));if(!await verifyAudit(e.events))throw new HttpError(409,'Audit integrity verification failed');const c=e.candidates.find(x=>x.id===e.selectedId)!;if(await digest(c.architecture)!==c.digest)throw new HttpError(409,'Architecture integrity verification failed');
  const existing=await database().prepare('SELECT payload FROM releases WHERE owner_id = ? AND experiment_id = ?').bind(owner,id).first<{payload:string}>();if(existing){await releaseLease(id,owner,token);return json(JSON.parse(existing.payload));}
  const release={id:crypto.randomUUID(),name:e.config.name,experimentId:e.id,createdAt:new Date().toISOString(),engineVersion:ENGINE_VERSION,mode:e.config.mode,architecture:c.architecture,architectureDigest:c.digest,goal:e.config.contract.goal,tools:e.config.contract.tools.map(name=>({name,...TOOL_CATALOG[name]})),evaluation:e.sealed,usage:e.usage,audit:e.events,limitations:['Tool workflows execute only registered deterministic tools.','Reference mode is a finite heuristic search, not model learning.','Bundled fixtures are synthetic, with held-out instances from the same generators.']};
  await appendEvent(e,'promoted',`Released ${release.id}; architecture SHA-256 ${c.digest}.`);e.updatedAt=new Date().toISOString();const rev=e.revision;e.revision++;
  await database().batch([database().prepare('INSERT INTO releases (id, owner_id, experiment_id, architecture_digest, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(release.id,owner,id,c.digest,JSON.stringify(release),release.createdAt),database().prepare('UPDATE experiments SET revision = ?, payload = ?, updated_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ? AND owner_id = ? AND lease_token = ? AND revision = ?').bind(e.revision,JSON.stringify(e),e.updatedAt,id,owner,token,rev)]);return json(release,201);
 }
 if(['completed','cancelled','failed'].includes(e.status))throw new HttpError(409,'Experiment is not runnable');
 let next;try{next=await advanceExperiment(e,createProvider());}catch(error){e.status='failed';e.phase='Failed';e.error=error instanceof Error?error.message:'Execution failed';e.updatedAt=new Date().toISOString();await appendEvent(e,'failed',e.error);next=e;}
 await saveExperiment(next,owner,token);return json(publicExperiment(next));
 }catch(e){if(token&&owner&&id)await releaseLease(id,owner,token).catch(()=>{});return failure(e);}
}
