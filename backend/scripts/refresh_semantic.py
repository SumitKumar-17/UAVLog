"""Refresh the precomputed semantic.signal_summary (run after ingest). First fill is non-concurrent; later refreshes are
concurrent so readers are never blocked."""
import time

import psycopg

from app.config import settings

with psycopg.connect(settings.dsn, autocommit=True) as c:
    populated = c.execute("SELECT ispopulated FROM pg_matviews WHERE schemaname='semantic' AND matviewname='signal_summary'").fetchone()[0]
    t0 = time.time()
    c.execute("SET maintenance_work_mem = '512MB'")
    c.execute(f"REFRESH MATERIALIZED VIEW {'CONCURRENTLY ' if populated else ''}semantic.signal_summary")
    n = c.execute("SELECT count(*) FROM semantic.signal_summary").fetchone()[0]
    print(f"signal_summary refreshed: {n} rows in {time.time() - t0:.1f}s")
