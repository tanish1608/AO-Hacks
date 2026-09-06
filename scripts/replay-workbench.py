"""Repeat the live writing task with its learned memory; no external app actions."""
from pathlib import Path
exec(compile(Path('scripts/smoke-workbench.py').read_text().split("settings=call('/api/integrations')")[0],'<api-helpers>','exec'))
prior=json.loads(Path('/private/tmp/foundry-live-workbench.json').read_text());path='/api/chats/'+prior['chat']['id'];s=call(path)
s=call(path+'/run',{'revision':s['chat']['revision'],'useMemory':True});run=s['runs'][0]
for i in range(60):
 if run['status']!='running':break
 s=call(path+'/advance',{'revision':s['chat']['revision'],'runId':run['id']});run=s['runs'][0]
 print('repeat step',i+1,run['phase'],run['status'],flush=True)
assert run['status'] in ['completed','exhausted'],run.get('error')
result={'scope':'Sequential repeat with the repaired graph and accumulated memory. Both changed since the initial baseline, so this does not isolate the causal effect of memory.','status':run['status'],'attempts':[{'iteration':a['iteration'],'score':a['evaluation']['score'],'checks':a['evaluation']['checks'],'activeStepSeconds':round(sum(t['durationMs'] for t in a['traces'])/1000,3),'memoryEntriesRetrieved':len(a['memoryIds'])} for a in run['attempts']],'usage':run['usage'],'memoryStatuses':[m['status'] for m in s['chat']['memory']]}
Path('docs/REPEAT_RUN_EVIDENCE.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
