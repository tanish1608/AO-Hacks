import { readFileSync } from 'node:fs';
import { ComposioGateway } from '../lib/workbench/composio.ts';
const vars=Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const gateway=new ComposioGateway(vars.COMPOSIO_API_KEY);
const session=await gateway.session('foundry-capability-check');
const connections=await gateway.connections(session.session_id);
console.log(JSON.stringify({sessionCreated:Boolean(session.session_id),connectedApps:connections.items?.map(c=>c.slug)??[]}));
const tools=await gateway.search(session.session_id,'Read the contents of a Google document by document ID',['googledocs']);
console.log(JSON.stringify({discovered:tools.map(t=>({slug:t.slug,toolkit:t.toolkit,readOnly:t.readOnly,schemaKeys:Object.keys(t.schema)}))}));
