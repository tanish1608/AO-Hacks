"""Move every owner-scoped row from one owner id to another.

Written for the move off Identity-Aware Proxy: rows created then are owned by
the IAP subject (`accounts.google.com:<id>`), and the application now owns them
by `users.id`. Operates on a local SQLite file only; it never contacts hosting.
"""
import argparse
import sqlite3
import sys

# Every table that carries an owner, with the column that makes a row unique
# for that owner. A None primary key means rows cannot collide.
TABLES = [
    ('chats', 'id'),
    ('agent_runs', 'id'),
    ('agent_run_metrics', 'run_id'),
    ('tool_knowledge', 'id'),
    ('tool_schema_cache', 'id'),
    ('tool_receipts', 'id'),
    ('workflow_publications', 'id'),
    ('integration_sessions', 'owner_id'),
]

p = argparse.ArgumentParser()
p.add_argument('--database', required=True)
p.add_argument('--from', dest='source', required=True)
p.add_argument('--to', dest='target', required=True)
p.add_argument('--apply', action='store_true', help='write the change; otherwise report only')
a = p.parse_args()

if a.source == a.target:
    raise SystemExit('Source and target owners are the same.')

db = sqlite3.connect(a.database)
db.row_factory = sqlite3.Row
existing = {r['name'] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

if not db.execute('SELECT 1 FROM users WHERE id=?', (a.target,)).fetchone():
    raise SystemExit(
        f'No user with id {a.target}. Sign up first, then read the id from the users table.'
    )

plan = []
for table, key in TABLES:
    if table not in existing:
        continue
    moving = db.execute(
        f'SELECT COUNT(*) c FROM {table} WHERE owner_id=?', (a.source,)
    ).fetchone()['c']
    if not moving:
        continue
    # A row already owned by the target with the same key would violate the
    # primary key. Report it instead of letting the UPDATE fail halfway.
    clash = db.execute(
        f'SELECT COUNT(*) c FROM {table} WHERE owner_id=? AND {key} IN '
        f'(SELECT {key} FROM {table} WHERE owner_id=?)',
        (a.target, a.source),
    ).fetchone()['c']
    plan.append((table, moving, clash))

if not plan:
    raise SystemExit(f'Nothing owned by {a.source}.')

width = max(len(t) for t, _, _ in plan)
for table, moving, clash in plan:
    note = f'  !! {clash} would collide with existing rows' if clash else ''
    print(f'{table:<{width}}  {moving:>5} rows{note}')

if any(clash for _, _, clash in plan):
    print('\nRefusing to move: the target owner already holds rows with the same keys.', file=sys.stderr)
    raise SystemExit(2)

if not a.apply:
    print('\nDry run. Re-run with --apply to write the change.')
    raise SystemExit(0)

with db:
    for table, _, _ in plan:
        db.execute(f'UPDATE {table} SET owner_id=? WHERE owner_id=?', (a.target, a.source))
print(f'\nMoved {sum(m for _, m, _ in plan)} rows to {a.target}.')
