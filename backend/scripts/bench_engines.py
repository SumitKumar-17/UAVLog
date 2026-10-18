"""Experiment 4: TimescaleDB columnstore vs DuckDB (over Parquet and native storage) on the same telemetry.

Compares storage size, six query shapes and load throughput. The telemetry is exported once from Postgres to a Parquet file sorted by
(signal, flight, time). Caveats stated in the report: DuckDB is embedded (no network, one process) while Postgres is client-server, and
concurrency is not measured.

  python scripts/bench_engines.py
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import duckdb
import numpy as np
import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--runs", type=int, default=5)
p.add_argument("--threads", type=int, default=4)
p.add_argument("--load-rows", type=int, default=5_000_000)
p.add_argument("--workdir", default=f"{settings.data_dir}/bench")
p.add_argument("--out-dir", default="/bench/results")
a = p.parse_args()
os.makedirs(a.workdir, exist_ok=True)
PQ, DB = f"{a.workdir}/telemetry.parquet", f"{a.workdir}/telemetry.duckdb"

pg = psycopg.connect(settings.dsn, autocommit=True)
pg.execute("SET statement_timeout = '900s'")
ROWS = pg.execute("SELECT count(*) FROM telemetry").fetchone()[0]
print(f"{ROWS:,} telemetry rows", flush=True)

duck = duckdb.connect()
duck.execute(f"SET threads = {a.threads}; SET memory_limit = '4GB'; SET temp_directory = '{a.workdir}/tmp'")
export_s = None
if not os.path.exists(PQ):
    duck.execute("INSTALL postgres; LOAD postgres")
    duck.execute(f"ATTACH '{settings.dsn}' AS pg (TYPE postgres, READ_ONLY)")
    t0 = time.time()
    duck.execute(f"COPY (SELECT flight_id::VARCHAR AS flight_id, ts, vendor_field_id, value FROM pg.public.telemetry ORDER BY vendor_field_id, flight_id, ts) "
                 f"TO '{PQ}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 122880)")
    export_s = time.time() - t0
    duck.execute("DETACH pg")
    print(f"exported to Parquet in {export_s:.0f}s", flush=True)
if not os.path.exists(DB):
    duck2 = duckdb.connect(DB)
    duck2.execute(f"SET threads = {a.threads}")
    duck2.execute(f"CREATE TABLE tel AS SELECT * FROM read_parquet('{PQ}')")
    duck2.close()
nat = duckdb.connect(DB, read_only=True)
nat.execute(f"SET threads = {a.threads}")

# ---- storage
cs = pg.execute("SELECT before_compression_total_bytes, after_compression_total_bytes FROM hypertable_columnstore_stats('telemetry')").fetchone()
storage = {"PostgreSQL rowstore + index (before compression)": cs[0], "TimescaleDB columnstore": cs[1],
           "Parquet (zstd, sorted)": os.path.getsize(PQ), "DuckDB native file": os.path.getsize(DB)}
for k, v in storage.items():
    print(f"  {k:<50} {v / 1e6:9.0f} MB  {v / ROWS:6.2f} B/row", flush=True)

# ---- queries: identical shapes on every engine
vf = pg.execute("SELECT id FROM vendor_field WHERE field = 'voltage_v' LIMIT 1").fetchone()[0]
flights = pg.execute("SELECT flight_id, count(*) c FROM telemetry GROUP BY 1 ORDER BY c").fetchall()
flight = str(flights[len(flights) // 2][0])
t_lo = pg.execute("SELECT percentile_disc(0.3) WITHIN GROUP (ORDER BY ts) FROM telemetry").fetchone()[0]
SHAPES = {
    "Q1 one signal of one flight, 1 s buckets": ("SELECT time_bucket('1 second', ts) b, min(value), max(value), avg(value) FROM {t} WHERE flight_id = '{f}' AND vendor_field_id = {v} GROUP BY 1",
                                                 "SELECT time_bucket(INTERVAL 1 SECOND, ts) b, min(value), max(value), avg(value) FROM {t} WHERE flight_id = '{f}' AND vendor_field_id = {v} GROUP BY 1"),
    "Q2 one signal across all flights": ("SELECT flight_id, min(value), max(value) FROM {t} WHERE vendor_field_id = {v} GROUP BY flight_id", None),
    "Q3 every signal of one flight": ("SELECT vendor_field_id, avg(value), max(value) FROM {t} WHERE flight_id = '{f}' GROUP BY 1", None),
    "Q4 one signal in a 90 day window": ("SELECT count(*), avg(value) FROM {t} WHERE ts >= '{t0}' AND ts < '{t0}'::timestamptz + interval '90 days' AND vendor_field_id = {v}", None),
    "Q5 count and mean per signal, all data": ("SELECT vendor_field_id, count(*), avg(value) FROM {t} GROUP BY 1", None),
    "Q6 min/max/mean per flight and signal (the summary build)": ("SELECT flight_id, vendor_field_id, min(value), max(value), avg(value), count(*) FROM {t} GROUP BY 1, 2", None),
}


def bench(run, sql):
    run(sql)
    lat = []
    for _ in range(a.runs):
        t = time.perf_counter()
        run(sql)
        lat.append((time.perf_counter() - t) * 1000)
    return float(np.median(lat))


ENGINES = {
    "TimescaleDB columnstore": (lambda s: pg.execute(s).fetchall(), "telemetry", 0),
    "DuckDB over Parquet": (lambda s: duck.execute(s).fetchall(), f"read_parquet('{PQ}')", 1),
    "DuckDB native table": (lambda s: nat.execute(s).fetchall(), "tel", 1),
}
results = {e: {} for e in ENGINES}
for qname, (pg_sql, duck_sql) in SHAPES.items():
    row = []
    for e, (run, table, is_duck) in ENGINES.items():
        sql = (duck_sql or pg_sql).format(t=table, f=flight, v=vf, t0=str(t_lo)) if is_duck else pg_sql.format(t=table, f=flight, v=vf, t0=str(t_lo))
        try:
            results[e][qname] = bench(run, sql)
        except Exception as ex:  # noqa: BLE001 - record and continue
            results[e][qname] = None
            print(f"   {e} {qname[:2]} failed: {str(ex).splitlines()[0]}", flush=True)
        row.append(results[e][qname])
    print(f"{qname[:58]:<58} " + "  ".join(f"{('%.1f ms' % r) if r is not None else 'n/a':>12}" for r in row), flush=True)

# ---- load throughput: the first N rows into each engine
sample = pg.execute("SELECT flight_id, ts, vendor_field_id, value FROM telemetry LIMIT %s", (a.load_rows,)).fetchall()
load = {}
pg.execute("DROP TABLE IF EXISTS bench.load_tel")
pg.execute("CREATE SCHEMA IF NOT EXISTS bench")
pg.execute("CREATE TABLE bench.load_tel (flight_id uuid NOT NULL, ts timestamptz NOT NULL, vendor_field_id smallint NOT NULL, value float8 NOT NULL)")
pg.execute("SELECT create_hypertable('bench.load_tel', by_range('ts', INTERVAL '7 days'))")
t0 = time.time()
with pg.cursor() as cur, cur.copy("COPY bench.load_tel FROM STDIN (FORMAT BINARY)") as cp:
    cp.set_types(["uuid", "timestamptz", "int2", "float8"])
    for r in sample:
        cp.write_row(r)
load["TimescaleDB COPY into a hypertable (uncompressed)"] = len(sample) / (time.time() - t0)
pg.execute("DROP TABLE bench.load_tel")
mem = duckdb.connect()
mem.execute("CREATE TABLE t (flight_id VARCHAR, ts TIMESTAMPTZ, vendor_field_id SMALLINT, value DOUBLE)")
t0 = time.time()
mem.executemany("INSERT INTO t VALUES (?, ?, ?, ?)", [(str(r[0]), r[1], r[2], r[3]) for r in sample[:200_000]])
load["DuckDB row-by-row INSERT (200k rows, for contrast)"] = 200_000 / (time.time() - t0)
t0 = time.time()
mem.execute(f"INSERT INTO t SELECT flight_id, ts, vendor_field_id, value FROM read_parquet('{PQ}') LIMIT {len(sample)}")
load["DuckDB bulk INSERT from Parquet"] = len(sample) / (time.time() - t0)
t0 = time.time()
mem.execute(f"COPY (SELECT * FROM t) TO '{a.workdir}/load_test.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)")
load["DuckDB write to Parquet"] = len(sample) / (time.time() - t0)
os.remove(f"{a.workdir}/load_test.parquet")
for k, v in load.items():
    print(f"  load: {k:<52} {v / 1e3:9.0f}k rows/s", flush=True)

meta = {"taken_at": datetime.now(timezone.utc).isoformat(), "rows": ROWS, "runs": a.runs, "threads": a.threads, "duckdb": duckdb.__version__,
        "versions": dict(pg.execute("SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb'").fetchall()), "export_s": export_s}
os.makedirs(a.out_dir, exist_ok=True)
json.dump({"meta": meta, "storage_bytes": storage, "queries_p50_ms": results, "load_rows_per_s": load}, open(f"{a.out_dir}/engines_{ROWS}.json", "w"), indent=1)
md = [f"# TimescaleDB vs DuckDB on {ROWS:,} telemetry rows", "", f"Median of {a.runs} warm runs; DuckDB {duckdb.__version__} with {a.threads} threads, TimescaleDB {meta['versions'].get('timescaledb')} "
      "(client-server, default parallelism). DuckDB is embedded; concurrency is not measured.", "", "## Storage", "", "| representation | size | bytes per row |", "|---|---|---|"]
md += [f"| {k} | {v / 1e6:.0f} MB | {v / ROWS:.2f} |" for k, v in storage.items()]
md += ["", "## Query latency (p50)", "", "| query | " + " | ".join(ENGINES) + " |", "|---|" + "---|" * len(ENGINES)]
for q in SHAPES:
    md.append(f"| {q} | " + " | ".join((f"{results[e][q]:.1f} ms" if results[e][q] is not None else "n/a") for e in ENGINES) + " |")
md += ["", "## Load throughput", "", "| path | rows per second |", "|---|---|"] + [f"| {k} | {v:,.0f} |" for k, v in load.items()]
open(f"{a.out_dir}/engines_{ROWS}.md", "w").write("\n".join(md) + "\n")
print(f"wrote {a.out_dir}/engines_{ROWS}.md")
