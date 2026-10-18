"""Refresh the precomputed semantic.signal_summary and the 1-second continuous aggregate (run after ingest). The first fill of the
summary is non-concurrent; later refreshes are concurrent so readers are never blocked."""
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
    t0 = time.time()
    c.execute("CALL refresh_continuous_aggregate('telemetry_1s', NULL, NULL)")
    n = c.execute("SELECT count(*) FROM telemetry_1s").fetchone()[0]
    print(f"telemetry_1s refreshed: {n:,} rows in {time.time() - t0:.1f}s")
