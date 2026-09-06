"""Live Gemini/API verification. No external app actions are executed."""
import json,urllib.request,urllib.error,http.cookiejar,time
BASE='http://127.0.0.1:3000'
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.open(BASE+'/signin-with-chatgpt?return_to=/',timeout=90).read()
def call(path,body=None,expected=200,headers=None):
 req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':BASE,**(headers or {})})
 try:
  with opener.open(req,timeout=160) as r:status=r.status;raw=r.read()
 except urllib.error.HTTPError as e:status=e.code;raw=e.read()
 try:data=json.loads(raw)
 except: data={'error':'Non-JSON HTTP response'}
 assert status==expected,(path,status,data)
 return data
settings=call('/api/integrations');print('integrations:',{k:settings[k] for k in ['gemini','composio','langsmith','connectionError']},flush=True)
call('/api/chats',{'message':''},400)
call('/api/chats',{'message':'test'},403,{'Origin':'https://untrusted.example'})
print('invalid input and cross-origin rejection passed',flush=True)
s=call('/api/chats',{'message':'Create a concise product launch blog using ONLY this supplied brief: Product: Atlas Notes. Features: offline writing, Markdown export, and shared notebooks. Audience: small research teams. Tone: practical and direct. Deliver 160–220 words with a title and three short sections. Do not invent features, pricing, statistics, citations, or links. No external apps or tools. Use exactly two agents: a writer and a reviewer who produces the final revised blog.'},201)
chat=s['chat'];path='/api/chats/'+chat['id'];assert 'sessionId' not in chat
print('designed:',len(chat['versions'][-1]['workflow']['nodes']),'agents',flush=True)
s=call(path+'/settings',{'revision':chat['revision'],'target':.8,'maxIterations':2,'maxToolCalls':10});chat=s['chat']
s=call(path+'/run',{'revision':chat['revision'],'useMemory':True});run=s['runs'][0]
for i in range(70):
 if run['status']!='running':break
 s=call(path+'/advance',{'revision':s['chat']['revision'],'runId':run['id']});run=s['runs'][0]
 print('step',i+1,run['phase'],run['status'],run['usage']['inputTokens']+run['usage']['outputTokens'],flush=True)
assert run['status'] in ['completed','exhausted'],run.get('error')
assert run['attempts'][-1]['evaluation'] is not None
assert run['usage']['inputTokens']>0
assert all(t['kind']!='tool' for a in run['attempts'] for t in a['traces'])
call(path+'/advance',{'revision':0,'runId':run['id']},409)
persisted=call(path);assert persisted['runs'][0]['id']==run['id']
print(json.dumps({'status':run['status'],'scores':[a['evaluation']['score'] for a in run['attempts'] if a['evaluation']],'memories':len(s['chat']['memory']),'usage':run['usage'],'chatId':chat['id']}),flush=True)
open('/private/tmp/foundry-live-workbench.json','w').write(json.dumps(s))
