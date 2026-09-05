import { authorize, failure, json } from '@/lib/server/security';
import { database } from '@/lib/server/store';
export async function GET(request:Request){try{const owner=await authorize(request);const rows=await database().prepare('SELECT payload FROM releases WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100').bind(owner).all<{payload:string}>();return json({releases:rows.results.map(r=>JSON.parse(r.payload))});}catch(e){return failure(e);}}
