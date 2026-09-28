/** Create real, model-generated startup demos with traceable synthetic fixtures. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { SqliteD1 } from '../server/d1-sqlite.mjs';
import {
  createChat,
  design,
  startRun,
  announceTest,
} from '../lib/workbench/engine.ts';
import { advanceResilient } from '../lib/workbench/recovery.ts';
import { workbenchModel } from '../lib/workbench/model.ts';
import { validateCases, checkOutput } from '../lib/workbench/improvement.ts';
import { publication } from '../lib/workbench/sharing.ts';
import { digest } from '../lib/engine/runtime.ts';
import type { Chat, Run } from '../lib/workbench/types.ts';
const fixtures = JSON.parse(
  readFileSync('lib/workbench/startup-demos.json', 'utf8'),
) as {
  id: string;
  title: string;
  description: string;
  prompt: string;
  cases: unknown;
}[];
const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ''),
      ];
    }),
);
const dbPath = process.env.DEMO_DB;
if (!dbPath) throw Error('Set DEMO_DB to the local preview database.');
const db = new SqliteD1(dbPath).db;
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
const owner = process.env.DEMO_OWNER ?? 'local_seedy';
const model = workbenchModel({ ...vars, ...process.env });
let nextCall = Promise.resolve();
const deps = {
  model: {
    async json<T>(
      system: string,
      input: unknown,
      schema: Record<string, unknown>,
    ) {
      const slot = nextCall.then(
        () => new Promise<void>((resolve) => setTimeout(resolve, 4000)),
      );
      nextCall = slot;
      await slot;
      return model.json<T>(system, input, schema);
    },
  },
  tools: null,
};
mkdirSync('outputs/startup-demos', { recursive: true });
function save(chat: Chat, runs: Run[]) {
  db.transaction(() => {
    db.prepare(
      'INSERT INTO chats(id,owner_id,title,revision,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at',
    ).run(
      chat.id,
      owner,
      chat.title,
      chat.revision,
      JSON.stringify(chat),
      chat.createdAt,
      chat.updatedAt,
    );
    for (const r of runs)
      db.prepare(
        'INSERT INTO agent_runs(id,chat_id,owner_id,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at',
      ).run(
        r.id,
        chat.id,
        owner,
        r.status,
        JSON.stringify(r),
        r.createdAt,
        r.updatedAt,
      );
  })();
}
const reports = await Promise.all(
  fixtures.map(async (fixture) => {
    const path = `outputs/startup-demos/${fixture.id}.json`;
    if (existsSync(path) && process.argv.includes('--resume')) {
      const prior = JSON.parse(readFileSync(path, 'utf8'));
      if (prior.finished) return prior.report;
    }
    const prior = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : null;
    let chat = await design(
      prior?.chat ?? createChat(crypto.randomUUID()),
      fixture.prompt +
        ' Use agent IDs intake, analysis, challenge, and reviewer; all dependencies must reference these exact IDs. No word-count requirements or word_count rubric criteria. Every final summary count must be a number, not a list; detailed lists belong in the other fields. Return strict JSON with no surrounding prose. Analysis of supplied evidence requires no external tools.',
      deps,
      [],
    );
    // Author the evaluation contract explicitly; model-invented constraints are not product requirements.
    const workflow = chat.versions.at(-1)!.workflow;
    workflow.criteria = [
      {id:'grounded',name:'Source-grounded findings',description:'Factual claims cite supplied source or task IDs; do not invent evidence, deadlines, owners, or external actions.',weight:3,required:true},
      {id:'contract',name:'Complete output contract',description:'Return valid JSON with every field requested by the user, correct summary types and values, and a readable executive_brief. Summary count fields are numbers; detailed item lists go in the report fields.',weight:3,required:true},
      {id:'useful',name:'Actionable decision support',description:'Provide a practical prioritized recommendation with uncertainties and next steps, suited to the actual source packet. No arbitrary word count is required.',weight:1,required:true},
    ];
    const final = workflow.nodes.find(n => !workflow.nodes.some(other => other.dependsOn.includes(n.id)))!;
    final.instruction += ' Return one strict JSON object without surrounding text. All summary counts (including conflicting_ids when present) must be JSON numbers; put detailed conflict records in exceptions. executive_brief is a concise plain Markdown string with source IDs. Use only legal JSON string escapes; do not escape backticks or apostrophes. Keep the complete JSON under 4500 characters. Do not copy malformed JSON from upstream: independently reconstruct and verify the final response.';
    chat.messages.push({id:crypto.randomUUID(),role:'assistant',createdAt:new Date().toISOString(),content:'Design review set the evaluation contract explicitly: source grounding, the requested output fields, and actionable recommendations. Unsupported model-invented word-count requirements are excluded from these new runs. Previous failures and rubrics remain in their original runs.'});
    chat.title = fixture.title;
    chat.versions.at(-1)!.workflow.title = fixture.title;
    chat.versions.at(-1)!.digest = await digest(chat.versions.at(-1)!.workflow);
    chat.regressionCases = validateCases(fixture.cases);
    chat.settings = { target: 0.85, maxIterations: 2, maxToolCalls: 8 };
    chat.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content:
        'This demonstration uses clearly labeled fictional source packets. I will test the edge cases, then a reserved follow-up input. Deterministic checks verify specific output fields; the model judge reviews evidence and usefulness. No external accounts are used or changed.',
    });
    const runs: Run[] = prior?.runs ?? [];
    const currentRuns: Run[] = [];
    const checks: unknown[] = [];
    save(chat, runs);
    for (const testCase of chat.regressionCases) {
      let run = await startRun(chat, false, undefined, {
        mode: 'test',
        input: testCase.input,
      });
      run.regressionCase = structuredClone(testCase);
      run.maxIterations = testCase.heldOut ? 1 : 2;
      announceTest(chat, run);
      runs.push(run);
      currentRuns.push(run);
      for (let step = 0; run.status === 'running' && step < 65; step++) {
        ({ chat, run } = await advanceResilient(chat, run, deps));
        runs[runs.length - 1] = run;
        currentRuns[currentRuns.length - 1] = run;
        save(chat, runs);
        writeFileSync(
          path,
          JSON.stringify({ chat, runs, finished: false }, null, 2),
        );
        console.log(
          `${fixture.id}: case ${runs.length}, step ${step + 1}, ${run.phase}, ${run.status}`,
        );
      }
      if (run.status === 'running')
        throw Error(`${fixture.id}: exceeded bounded demo steps`);
      const a = run.attempts.at(-1)!;
      const output =
        a.states.find(
          (s) => !a.workflow.nodes.some((n) => n.dependsOn.includes(s.nodeId)),
        )?.output ?? '';
      const numeric = testCase.checks.map((check) => ({
        ...check,
        passed: checkOutput(output, check),
      }));
      checks.push({
        case: testCase.name,
        heldOut: Boolean(testCase.heldOut),
        status: run.status,
        attempts: run.attempts.length,
        score: a.evaluation?.score,
        checks: numeric,
        usage: run.usage,
      });
      writeFileSync(`outputs/startup-demos/${testCase.id}-result.json`, output);
      if (numeric.some((c) => !c.passed) || run.status !== 'completed')
        console.log(
          `${fixture.id}: verification needs attention; retaining failure evidence`,
        );
    }
    const allPassed = currentRuns.every(
      (r) =>
        r.status === 'completed' &&
        r.attempts.at(-1)?.evaluation?.verdict === 'pass',
    );
    let link: string | null = null;
    if (allPassed) {
      const published = await publication(
        chat,
        fixture.description +
          ' Upload your own source packet or use the labeled fictional example. Outputs are drafts for review.',
      );
      link = crypto.randomUUID();
      db.prepare(
        'INSERT INTO workflow_publications(id,owner_id,chat_id,payload,created_at) VALUES(?,?,?,?,?)',
      ).run(
        link,
        owner,
        chat.id,
        JSON.stringify(published),
        published.createdAt,
      );
    }
    chat.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content: allPassed
        ? 'Both source packets passed their frozen checks and model review. Open Tests for the saved cases, or use Host to open this workflow’s run page. These are two synthetic cases, not a general accuracy estimate.'
        : 'At least one source packet needs attention. The failed run and reviewer feedback are preserved here; this workflow has not been hosted.',
    });
    save(chat, runs);
    const report = {
      fixture: fixture.id,
      chatId: chat.id,
      publicationId: link,
      passed: allPassed,
      checks,
    };
    writeFileSync(
      path,
      JSON.stringify({ chat, runs, finished: true, report }, null, 2),
    );
    return report;
  }),
);
writeFileSync(
  'outputs/startup-demos/evidence.json',
  JSON.stringify(reports, null, 2),
);
console.log(
  JSON.stringify(
    reports.map((r) => ({
      fixture: r.fixture,
      chatId: r.chatId,
      passed: r.passed,
      publicationId: r.publicationId,
    })),
    null,
    2,
  ),
);
db.close();
