"""Exercise the local API; outputs contain only IDs, metrics, and check names."""
import json, sys, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
BASE='http://127.0.0.1:3000'
cookies=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
with opener.open(BASE+'/signin-with-chatgpt?return_to=/',timeout=60) as signed_in:
    assert signed_in.status==200
def call(path,body=None,expected=200,headers=None):
    request=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':BASE,**(headers or {})})
    try:
        with opener.open(request,timeout=100) as response: status=response.status; data=json.load(response)
    except urllib.error.HTTPError as error:
        status=error.code
        raw=error.read()
        try: data=json.loads(raw)
        except json.JSONDecodeError: data={'error':'Non-JSON rejection response'}
    assert status==expected, (path,status,data)
    return data
catalog=call('/api/catalog')
print('catalog:',len(catalog['contracts']),'domains; provider configured:',catalog['provider']['configured'],flush=True)
call('/api/experiments',{'contractId':'missing'},400)
call('/api/experiments',{'contractId':catalog['contracts'][0]['id']},403,{'Origin':'https://untrusted.example'})
print('invalid contract and cross-origin rejection passed',flush=True)
mode='model' if '--model' in sys.argv else 'reference'
contracts=catalog['contracts'] if '--all' in sys.argv else catalog['contracts'][:1]
for contract in contracts:
    run=call('/api/experiments',{'contractId':contract['id'],'name':f"{contract['name']} · {'Gemini' if mode=='model' else 'reference'} verification",'mode':mode,'iterations':4 if mode=='model' else 6},201)
    assert 'test' not in run['config']['contract'] and 'development' not in run['config']['contract']
    path='/api/experiments/'+run['id']
    call(path+'/promote',{'revision':run['revision']},422)
    if mode=='reference':
        def race():
            request=urllib.request.Request(BASE+path+'/advance',data=json.dumps({'revision':run['revision']}).encode(),headers={'Content-Type':'application/json','Origin':BASE})
            try:
                with opener.open(request,timeout=60) as response:return response.status,json.load(response)
            except urllib.error.HTTPError as error:return error.code,json.load(error)
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:race(),range(2)))
        assert sorted(r[0] for r in results)==[200,409],results
        run=next(r[1] for r in results if r[0]==200)
        print('concurrent mutation serialized:',run['id'],flush=True)
    while run['status'] in ('ready','running'):
        previous=run['revision'];run=call(path+'/advance',{'revision':previous})
        assert run['revision']==previous+1
        print(contract['domain'],run['phase'],flush=True)
    if run['status']=='failed':raise AssertionError(run['error'])
    assert run['sealed'] is not None
    call(path+'/advance',{'revision':run['revision']-1},409)
    if run['sealed']['selected']['accuracy']>=run['config']['qualityFloor'] and run['sealed']['selected']['reliability']>=run['config']['qualityFloor']:
        release=call(path+'/promote',{'revision':run['revision']},201)
        latest=call(path)
        again=call(path+'/promote',{'revision':latest['revision']})
        assert release['id']==again['id']
        assert any(r['id']==release['id'] for r in call('/api/releases')['releases'])
        print('promotion, persistence, and idempotent retry passed',flush=True)
    print(json.dumps({'domain':contract['domain'],'mode':mode,'id':run['id'],'baseline':run['sealed']['baseline']['accuracy'],'selected':run['sealed']['selected']['accuracy'],'candidates':len(run['candidates']),'usage':run['usage']}),flush=True)
if mode=='reference':
    run=call('/api/experiments',{'contractId':catalog['contracts'][0]['id'],'name':'Cancellation verification'},201)
    path='/api/experiments/'+run['id'];cancelled=call(path+'/cancel',{'revision':run['revision']});assert cancelled['status']=='cancelled';call(path+'/advance',{'revision':cancelled['revision']},409)
    print('cancellation and terminal-state rejection passed',flush=True)
