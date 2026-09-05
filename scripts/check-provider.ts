import {readFile} from 'node:fs/promises';
import {modelProvider} from '../lib/engine/model-provider.ts';
import {CONTRACTS} from '../lib/engine/contracts.ts';
import {validateArchitecture} from '../lib/engine/runtime.ts';
const env=Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const provider=modelProvider({geminiKey:env.GEMINI_API_KEY,openaiKey:env.OPENAI_API_KEY,model:env.FOUNDRY_MODEL});
if(!provider)throw new Error('Provider is not configured');
try{const r=await provider.generate({contract:{goal:CONTRACTS[0].goal,tools:CONTRACTS[0].tools},previous:null,failures:[],generation:0,maxOutputTokens:4000,maxTotalTokens:20000});validateArchitecture(r.architecture,CONTRACTS[0].tools);console.log(JSON.stringify({model:env.FOUNDRY_MODEL,validArchitecture:true,nodes:r.architecture.nodes.map(n=>n.tool),usage:r.usage}));}catch(e){console.error(e instanceof Error?e.message:'Provider check failed');process.exitCode=1;}
