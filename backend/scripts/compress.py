"""Convert telemetry chunks to columnstore. Idempotent and resumable: skips chunks already converted;
each chunk is its own transaction, so an interruption loses at most one chunk of work."""
import argparse
import time

import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--limit", type=int, default=0, help="max chunks to convert; 0 = all")
a = p.parse_args()

with psycopg.connect(settings.dsn, autocommit=True) as c:
    chunks = [r[0] for r in c.execute(
        "SELECT format('%I.%I', chunk_schema, chunk_name) FROM timescaledb_information.chunks "
        "WHERE hypertable_name='telemetry' AND NOT is_compressed ORDER BY range_start")]
    if a.limit:
        chunks = chunks[: a.limit]
    print(f"{len(chunks)} chunks to convert", flush=True)
    t0 = time.time()
    for i, ch in enumerate(chunks, 1):
        c.execute("SELECT compress_chunk(%s::regclass, if_not_compressed => true)", (ch,))
        if i % 10 == 0 or i == len(chunks):
            print(f"[{i}/{len(chunks)}] {time.time() - t0:.0f}s", flush=True)
print("done")
