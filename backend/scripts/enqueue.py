"""Load a manifest into the ingest job queue. Safe to re-run; also re-activates 'missing' jobs whose file arrived."""
import argparse
import json
from pathlib import Path

import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--manifest", default=f"{settings.data_dir}/raw/manifest.jsonl")
p.add_argument("--ulg-dir", default=f"{settings.data_dir}/raw/ulg")
a = p.parse_args()

with psycopg.connect(settings.dsn) as conn, conn.cursor() as cur:
    added = 0
    for line in open(a.manifest):
        rec = json.loads(line)
        cur.execute(
            """INSERT INTO ingest_job (log_id, payload, status)
               VALUES (%s, %s, CASE WHEN EXISTS (SELECT 1 FROM flight WHERE source_ref = %s)
                                    THEN 'done' ELSE 'pending' END)
               ON CONFLICT (log_id) DO NOTHING""",
            (rec["log_id"], json.dumps(rec), rec["log_id"]),
        )
        added += cur.rowcount
        if Path(f"{a.ulg_dir}/{rec['log_id']}.ulg").exists():
            cur.execute("UPDATE ingest_job SET status='pending' WHERE log_id=%s AND status='missing'", (rec["log_id"],))
    conn.commit()
    print(f"enqueued {added} new jobs")
    for status, n in cur.execute("SELECT status, count(*) FROM ingest_job GROUP BY 1 ORDER BY 1"):
        print(f"  {status}: {n}")
