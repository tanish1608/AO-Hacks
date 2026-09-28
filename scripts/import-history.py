#!/usr/bin/env python3
"""
Copy task history from one Agent Foundry database into another, rewriting the
owner id.

Every row is owner-scoped, and the deployment runs in open mode under a
different owner than a local dev session, so a straight file copy would leave
the history invisible. Existing rows in the target are kept; a row whose
primary key already exists is skipped rather than overwritten.
"""
import argparse, sqlite3, sys

# Ordered so parents land before the rows that reference them.
TABLES = [
    ("chats", "id"),
    ("agent_runs", "id"),
    ("agent_run_metrics", "run_id"),
    ("tool_knowledge", "id"),
    ("tool_receipts", "id"),
    ("tool_schema_cache", "id"),
    ("workflow_publications", "id"),
    ("integration_sessions", "owner_id"),
]

def columns(con, table):
    return [c[1] for c in con.execute(f"pragma table_info('{table}')")]

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--from-owner", required=True)
    p.add_argument("--to-owner", required=True)
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()

    src = sqlite3.connect(f"file:{a.source}?mode=ro", uri=True)
    dst = sqlite3.connect(a.target)
    dst.execute("PRAGMA foreign_keys = OFF")
    report = []
    for table, pk in TABLES:
        try:
            cols = columns(src, table)
        except sqlite3.OperationalError:
            continue
        if not cols or "owner_id" not in cols:
            continue
        if not columns(dst, table):
            report.append((table, 0, 0, "missing in target"))
            continue
        rows = src.execute(
            f"SELECT {','.join(cols)} FROM '{table}' WHERE owner_id=?",
            (a.from_owner,),
        ).fetchall()
        owner_at = cols.index("owner_id")
        existing = {r[0] for r in dst.execute(f"SELECT {pk} FROM '{table}'")}
        pk_at = cols.index(pk)
        inserted = skipped = 0
        for row in rows:
            values = list(row)
            values[owner_at] = a.to_owner
            # integration_sessions is keyed by owner_id, so the collision test
            # has to use the rewritten value, not the source's.
            if values[pk_at] in existing:
                skipped += 1
                continue
            if not a.dry_run:
                dst.execute(
                    f"INSERT INTO '{table}'({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                    values,
                )
            inserted += 1
        report.append((table, inserted, skipped, ""))
    if not a.dry_run:
        dst.commit()
    width = max(len(t) for t, *_ in report) if report else 10
    for table, ins, skip, note in report:
        print(f"  {table:<{width}}  +{ins:<4} skipped {skip:<4} {note}")
    total = sum(i for _, i, _, _ in report)
    print(f"{'would copy' if a.dry_run else 'copied'} {total} rows")
    return 0

if __name__ == "__main__":
    sys.exit(main())
