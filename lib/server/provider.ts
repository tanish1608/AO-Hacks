import { env } from 'cloudflare:workers';
import { modelProvider } from '../engine/model-provider.ts';
function settings(){const e=env as unknown as Record<string,string|undefined>;return{geminiKey:e.GEMINI_API_KEY,openaiKey:e.OPENAI_API_KEY,model:e.FOUNDRY_MODEL,inputPrice:e.FOUNDRY_INPUT_PRICE_PER_MILLION,outputPrice:e.FOUNDRY_OUTPUT_PRICE_PER_MILLION};}
export function providerStatus(){const s=settings();return{configured:Boolean(modelProvider(s)),model:s.model??null,pricingConfigured:Boolean(s.inputPrice?.trim()&&s.outputPrice?.trim())};}
export function createProvider(){return modelProvider(settings());}
