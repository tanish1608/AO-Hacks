import { getChatGPTUser } from '@/app/chatgpt-auth';
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
export async function authorize(request:Request,write=false){
 const user=await getChatGPTUser();if(!user)throw new HttpError(401,'Sign in to access this workspace');
 if(write){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new HttpError(403,'Cross-origin writes are not allowed');if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Use application/json');}
 return user.userId;
}
export async function readJson(request:Request){const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Request body is required');let size=0;const chunks:Uint8Array[]=[];while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>180000){await reader.cancel();throw new HttpError(413,'Task contract is too large');}chunks.push(r.value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON body');}}
export function json(value:unknown,status=200,extra:Record<string,string>={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
export function failure(e:unknown){return json({error:e instanceof HttpError?e.message:'Request could not be completed. Check the server logs.'},e instanceof HttpError?e.status:500);}
