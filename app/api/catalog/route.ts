import { publicCatalog } from '@/lib/engine/contracts';
import { TOOL_CATALOG } from '@/lib/engine/runtime';
import { providerStatus } from '@/lib/server/provider';
import { authorize, failure, json } from '@/lib/server/security';
export async function GET(request:Request){try{await authorize(request);return json({contracts:publicCatalog(),tools:TOOL_CATALOG,provider:providerStatus(),engineVersion:'0.1.0'});}catch(e){return failure(e);}}
