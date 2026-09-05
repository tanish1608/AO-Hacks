import { authorize, failure, json } from '@/lib/server/security';
import { loadExperiment, publicExperiment } from '@/lib/server/store';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const owner=await authorize(request);return json(publicExperiment(await loadExperiment((await params).id,owner)));}catch(e){return failure(e);}}
