"""Convert telemetry chunks to columnstore. Idempotent and resumable; each chunk is its own transaction, so an
interruption loses at most one chunk of work. Also re-compresses *partial* chunks: rows inserted into an already
compressed chunk stay uncompressed until the chunk is compressed again."""
import argparse
import time

import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--limit", type=int, default=0, help="max chunks to convert; 0 = all")
a = p.parse_args()

with psycopg.connect(settings.dsn, autocommit=True) as c:
    # status bit 1 = compressed, bit 8 = partially compressed (internal catalog; checked on TimescaleDB 2.30)
    chunks = [r[0] for r in c.execute(
        "SELECT c.relid::regclass::text FROM _timescaledb_catalog.chunk c "
        "JOIN _timescaledb_catalog.hypertable h ON h.id = c.hypertable_id "
        "WHERE h.table_name = 'telemetry' AND (c.status & 1 = 0 OR c.status & 8 = 8) ORDER BY c.id")]
    if a.limit:
        chunks = chunks[: a.limit]
    print(f"{len(chunks)} chunks to convert", flush=True)
    t0 = time.time()
    for i, ch in enumerate(chunks, 1):
        c.execute("SELECT compress_chunk(%s::regclass, if_not_compressed => true)", (ch,))
        if i % 10 == 0 or i == len(chunks):
            print(f"[{i}/{len(chunks)}] {time.time() - t0:.0f}s", flush=True)
print("done")
