"""Build the HNSW index on event.embedding after bulk loading (building once is far cheaper than maintaining
it row by row). Idempotent; parameters are flags so the benchmark can compare variants."""
import argparse
import time

import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--m", type=int, default=16)
p.add_argument("--ef-construction", type=int, default=64)
p.add_argument("--name", default="event_embedding_hnsw")
p.add_argument("--rebuild", action="store_true")
a = p.parse_args()

with psycopg.connect(settings.dsn, autocommit=True) as c:
    if a.rebuild:
        c.execute(f"DROP INDEX IF EXISTS {a.name}")
    exists = c.execute("SELECT 1 FROM pg_indexes WHERE indexname = %s", (a.name,)).fetchone()
    if exists:
        print(f"{a.name} exists, skipping (use --rebuild)")
    else:
        c.execute("SET maintenance_work_mem = '1GB'")
        t0 = time.time()
        c.execute(f"CREATE INDEX {a.name} ON event USING hnsw (embedding vector_cosine_ops) "
                  f"WITH (m = {a.m}, ef_construction = {a.ef_construction}) WHERE embedding IS NOT NULL")
        size = c.execute("SELECT pg_size_pretty(pg_relation_size(%s::regclass))", (a.name,)).fetchone()[0]
        print(f"built {a.name} (m={a.m}, ef_construction={a.ef_construction}) in {time.time() - t0:.1f}s, size {size}")
