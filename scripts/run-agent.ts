import { readFileSync, existsSync } from 'node:fs';
import {
  createChat,
  design,
  startRun,
  advanceChatRun,
} from '../lib/workbench/engine.ts';
import { geminiModel } from '../lib/workbench/model.ts';
const local = existsSync('.dev.vars')
  ? Object.fromEntries(
      readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter((x) => x.includes('='))
        .map((x) => {
          const i = x.indexOf('=');
          return [
            x.slice(0, i).trim(),
            x
              .slice(i + 1)
              .trim()
              .replace(/^["']|["']$/g, ''),
          ];
        }),
    )
  : {};
const goal = process.argv.slice(2).join(' ');
if (!goal) {
  console.error(
    'Usage: npm run agent:run -- "A task using supplied content". Use the web workspace for connected apps and action review.',
  );
  process.exit(1);
}
const deps = {
  model: geminiModel({
    key: process.env.GEMINI_API_KEY || local.GEMINI_API_KEY,
    model:
      process.env.FOUNDRY_MODEL || local.FOUNDRY_MODEL || 'gemini-3.8-flash',
  }),
  tools: null,
};
let chat = await design(createChat(crypto.randomUUID()), goal, deps, []),
  run = await startRun(chat);
while (run.status === 'running')
  ({ chat, run } = await advanceChatRun(chat, run, deps));
console.log(JSON.stringify({ chat, run }, null, 2));
