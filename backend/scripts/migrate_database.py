"""Copy the whole database into another TimescaleDB (for example a managed Tiger Cloud service) with COPY, so it works across TimescaleDB versions.

The target must already have the schema (alembic upgrade head with DATABASE_URL pointing at it). Resumable and idempotent: small tables go through a temporary table and
INSERT .. ON CONFLICT DO NOTHING; telemetry is copied one flight at a time (the flight's rows and a marker row in migration_progress commit together) and the chunks are
compressed after every few flights, so the target never holds more than a few flights of uncompressed data (a free plan has only 750 MiB). The source is never modified.

  python scripts/migrate_database.py --target "$CLOUD_DATABASE_URL" [--batch 6] [--max-mb 700]
"""
import argparse
import time
from concurrent.futures import ThreadPoolExecutor

import psycopg

from app.config import settings

SMALL = ["concept", "vendor_field", "concept_relation", "field_mapping", "flight", "event", "flight_signature", "signature_scaler", "window_model",
         "signal_window", "note", "investigation", "saved_query", "ingest_job", "flight_task", "llm_call"]
p = argparse.ArgumentParser()
p.add_argument("--target", required=True)
p.add_argument("--batch", type=int, default=6, help="flights between compressions")
p.add_argument("--workers", type=int, default=4, help="flights copied in parallel")
p.add_argument("--max-mb", type=int, default=700, help="stop if the target database grows beyond this")
a = p.parse_args()

src = psycopg.connect(settings.dsn)
tgt = psycopg.connect(a.target, autocommit=True)
src.execute("SET statement_timeout = 0")
tgt.execute("SET statement_timeout = 0")
mb = lambda: tgt.execute("SELECT pg_database_size(current_database()) / 1048576").fetchone()[0]


def columns(conn, table: str) -> list[str]:
    """Writable columns of a table (generated columns are excluded: the target computes them)."""
    return [r[0] for r in conn.execute("""SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s AND is_generated = 'NEVER'
                                          AND coalesce(identity_generation, '') <> 'ALWAYS' ORDER BY ordinal_position""", (table,)).fetchall()]


def pipe(sql_out: str, params, sql_in: str, conn) -> int:
    """Stream a COPY from the source into a COPY on the target; returns the number of rows the target received."""
    cur = conn.cursor()
    with src.cursor().copy(sql_out, params) as out, cur.copy(sql_in) as inn:
        for block in out:
            inn.write(block)
    return cur.rowcount


def small_tables() -> None:
    for t in SMALL:
        cols = ", ".join('"%s"' % c for c in columns(tgt, t))  # quoted: a column may be named like a keyword (offset)
        n_src = src.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        n_tgt = tgt.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        if n_src == n_tgt:
            print(f"{t:18s} {n_src:>9,} rows already there", flush=True)
            continue
        t0 = time.time()
        with tgt.transaction():
            tgt.execute(f"CREATE TEMP TABLE _copy ON COMMIT DROP AS SELECT {cols} FROM {t} WITH NO DATA")
            pipe(f"COPY (SELECT {cols} FROM {t}) TO STDOUT (FORMAT binary)", None, f"COPY _copy ({cols}) FROM STDIN (FORMAT binary)", tgt)
            tgt.execute(f"INSERT INTO {t} ({cols}) SELECT {cols} FROM _copy ON CONFLICT DO NOTHING")
        print(f"{t:18s} {n_src:>9,} rows copied in {time.time() - t0:.1f} s", flush=True)
    for seq, table, col in tgt.execute("""SELECT pg_get_serial_sequence(c.table_name, c.column_name), c.table_name, c.column_name FROM information_schema.columns c
                                          WHERE c.table_schema = 'public' AND pg_get_serial_sequence(c.table_name, c.column_name) IS NOT NULL""").fetchall():
        tgt.execute(f'SELECT setval(%s, coalesce((SELECT max("{col}") FROM {table}), 1))', (seq,))


def compress(lo, hi) -> None:
    for (chunk,) in tgt.execute("SELECT show_chunks('telemetry', newer_than => %s, older_than => %s)::text", (lo, hi)).fetchall():
        tgt.execute("SELECT compress_chunk(%s::regclass, if_not_compressed => true)", (chunk,))


def copy_flight(fid) -> int:
    """One flight on its own connections: its rows and the progress marker commit together."""
    s = psycopg.connect(settings.dsn)
    t = psycopg.connect(a.target)
    try:
        with t.transaction():
            cur = t.cursor()
            with s.cursor().copy("COPY (SELECT flight_id, ts, vendor_field_id, value FROM telemetry WHERE flight_id = %s) TO STDOUT (FORMAT binary)", (fid,)) as out, \
                    cur.copy("COPY telemetry (flight_id, ts, vendor_field_id, value) FROM STDIN (FORMAT binary)") as inn:
                for block in out:
                    inn.write(block)
            n = cur.rowcount
            t.execute("INSERT INTO migration_progress VALUES (%s, %s)", (fid, n))
        return n
    finally:
        s.close()
        t.close()


def telemetry() -> None:
    tgt.execute("CREATE TABLE IF NOT EXISTS migration_progress (flight_id uuid PRIMARY KEY, rows bigint NOT NULL)")
    done = {r[0] for r in tgt.execute("SELECT flight_id FROM migration_progress").fetchall()}
    flights = [r[0] for r in src.execute("SELECT flight_id, count(*) FROM telemetry GROUP BY 1 ORDER BY 1").fetchall()]
    todo = [f for f in flights if f not in done]
    print(f"telemetry: {len(flights)} flights, {len(done)} already copied, {len(todo)} to go", flush=True)
    t0, rows = time.time(), 0
    with ThreadPoolExecutor(a.workers) as pool:
        for i in range(0, len(todo), a.batch):
            batch = todo[i:i + a.batch]
            rows += sum(pool.map(copy_flight, batch))
            lo, hi = src.execute("SELECT min(ts), max(ts) FROM telemetry WHERE flight_id = ANY(%s)", (batch,)).fetchone()
            t1 = time.time()
            compress(lo, hi)
            size = mb()
            print(f"  {i + len(batch):>4}/{len(todo)} flights, {rows:,} rows, {rows / (time.time() - t0):,.0f} rows/s overall (compressing the batch took {time.time() - t1:.0f} s), target {size:.0f} MB", flush=True)
            if size > a.max_mb:
                raise SystemExit(f"the target database is {size:.0f} MB, above --max-mb {a.max_mb}; stopping (rerun to resume after freeing space)")


def indexes() -> None:
    have = {r[0] for r in tgt.execute("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'").fetchall()}
    for name, definition in src.execute("""SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY(%s)""", (SMALL,)).fetchall():
        if name not in have:
            t0 = time.time()
            tgt.execute("SET maintenance_work_mem = '128MB'")
            tgt.execute(definition.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS").replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS"))
            print(f"index {name} built in {time.time() - t0:.1f} s", flush=True)


if __name__ == "__main__":
    small_tables()
    telemetry()
    indexes()
    tgt.execute("REFRESH MATERIALIZED VIEW semantic.signal_summary")
    tgt.execute("ANALYZE")
    print(f"done; target database {mb():.0f} MB", flush=True)
