"""Import exported Foundry snapshots into the local D1 database; never contacts hosting."""
import argparse
import glob
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--owner', required=True)
p.add_argument('snapshots', nargs='+')
args = p.parse_args()
paths = [x for x in glob.glob('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite') if not x.endswith('metadata.sqlite')]
if len(paths) != 1:
    raise SystemExit('Expected exactly one local D1 database.')
db = sqlite3.connect(paths[0])
backup = Path('outputs/local-migration')
backup.mkdir(parents=True, exist_ok=True)
db.backup(sqlite3.connect(backup / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.sqlite')))
for path in args.snapshots:
    data = json.loads(Path(path).read_text())
    chat = data['chat']
    chat['sessionId'] = None
    if db.execute('SELECT 1 FROM chats WHERE id=?', (chat['id'],)).fetchone():
        print('Already exists; preserved:', chat['id'])
        continue
    if any(r['status'] in ('running','paused','awaiting_approval') for r in data['runs']):
        raise SystemExit('Finish or stop runs before importing a snapshot.')
    with db:
        db.execute('INSERT INTO chats(id,owner_id,title,revision,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                   (chat['id'], args.owner, chat['title'], chat['revision'], json.dumps(chat), chat['createdAt'], chat['updatedAt']))
        for r in data['runs']:
            db.execute('INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?)', (r['id'], chat['id'], args.owner, r['status'], json.dumps(r), r['createdAt'], r['updatedAt']))
            if r.get('mode') == 'manual':
                continue
            last = r['attempts'][-1]
            traces = [t for a in r['attempts'] for t in a['traces']]
            tool_traces = [t for t in traces if t['kind'] == 'tool']
            search_traces = [t for t in traces if t['kind'] == 'search']
            evaluation = last.get('evaluation') or {}
            values = (r['id'],args.owner,chat['id'],r.get('experimentId'),r.get('arm'),int(r['useMemory']),r['status'],len(r['attempts']),int(r['status']=='completed' and bool(evaluation)),evaluation.get('score'),r['usage']['inputTokens'],r['usage']['outputTokens'],r['usage']['costUsd'],sum(t['durationMs'] for t in traces),len(tool_traces),sum(bool(t.get('error')) for t in tool_traces),len(search_traces),0,last['graphDigest'],r['createdAt'])
            db.execute('INSERT INTO agent_run_metrics VALUES('+','.join('?' for _ in values)+')', values)
    print('Imported:',chat['id'],chat['title'],len(data['runs']),'runs')
