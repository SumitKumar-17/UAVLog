"""Experiment 1: columnstore physical design for the telemetry hypertable.

The same rows (a subset of flights) are loaded into hypertables that differ in chunk interval, segmentby and orderby, compressed, and
measured for size, compression time and four query shapes. Plus a plain rowstore with a B-tree as the baseline.

  python scripts/bench_columnstore.py --flights 100
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--flights", type=int, default=100)
p.add_argument("--runs", type=int, default=7)
p.add_argument("--out-dir", default="/bench/results")
a = p.parse_args()

conn = psycopg.connect(settings.dsn, autocommit=True)
conn.execute("SET statement_timeout = '600s'; SET maintenance_work_mem = '1500MB'")

VARIANTS = [  # label, chunk interval, segmentby, orderby, compress?
    ("rowstore + b-tree (baseline)", "7 days", None, None, False),
    ("columnstore: segment (flight, signal), order ts [current]", "7 days", "flight_id, vendor_field_id", "ts", True),
    ("columnstore: segment flight, order (signal, ts)", "7 days", "flight_id", "vendor_field_id, ts", True),
    ("columnstore: segment signal, order (flight, ts)", "7 days", "vendor_field_id", "flight_id, ts", True),
    ("columnstore: no segmentby, order (flight, signal, ts)", "7 days", "", "flight_id, vendor_field_id, ts", True),
    ("columnstore: current, 1 day chunks", "1 day", "flight_id, vendor_field_id", "ts", True),
    ("columnstore: current, 30 day chunks", "30 days", "flight_id, vendor_field_id", "ts", True),
]

ids = [r[0] for r in conn.execute("SELECT id FROM flight ORDER BY id LIMIT %s", (a.flights,)).fetchall()]
conn.execute("CREATE SCHEMA IF NOT EXISTS bench")
conn.execute("DROP TABLE IF EXISTS bench.tel_src, bench.tel CASCADE")
t0 = time.time()
conn.execute("CREATE TABLE bench.tel_src AS SELECT flight_id, ts, vendor_field_id, value FROM telemetry WHERE flight_id = ANY(%s)", (ids,))
ROWS = conn.execute("SELECT count(*) FROM bench.tel_src").fetchone()[0]
print(f"{ROWS:,} rows from {len(ids)} flights staged in {time.time() - t0:.0f}s", flush=True)

# query parameters: a mid-sized flight, the battery voltage signal, and a 90-day window with plenty of data
vf = conn.execute("SELECT id FROM vendor_field WHERE field = 'voltage_v' LIMIT 1").fetchone()[0]
sizes = conn.execute("SELECT flight_id, count(*) c FROM bench.tel_src GROUP BY 1 ORDER BY c").fetchall()
flight = sizes[len(sizes) // 2][0]
t_lo = conn.execute("SELECT percentile_disc(0.3) WITHIN GROUP (ORDER BY ts) FROM bench.tel_src").fetchone()[0]
QUERIES = {
    "Q1 one signal of one flight, 1 s buckets": ("SELECT time_bucket('1 second', ts) b, min(value), max(value), avg(value) FROM bench.tel WHERE flight_id = %(f)s AND vendor_field_id = %(v)s GROUP BY 1", {"f": flight, "v": vf}),
    "Q2 one signal across all flights": ("SELECT flight_id, min(value), max(value) FROM bench.tel WHERE vendor_field_id = %(v)s GROUP BY flight_id", {"v": vf}),
    "Q3 every signal of one flight": ("SELECT vendor_field_id, avg(value), max(value) FROM bench.tel WHERE flight_id = %(f)s GROUP BY 1", {"f": flight}),
    "Q4 one signal in a 90 day window": ("SELECT count(*), avg(value) FROM bench.tel WHERE ts >= %(t)s AND ts < %(t)s::timestamptz + interval '90 days' AND vendor_field_id = %(v)s", {"v": vf, "t": t_lo}),
}


def median_ms(sql, params):
    conn.execute(sql, params).fetchall()  # warm-up
    lat = []
    for _ in range(a.runs):
        t = time.perf_counter()
        conn.execute(sql, params).fetchall()
        lat.append((time.perf_counter() - t) * 1000)
    return float(np.median(lat)), float(np.percentile(lat, 95))


results = []
for label, interval, seg, order, compress in VARIANTS:
    conn.execute("DROP TABLE IF EXISTS bench.tel CASCADE")
    conn.execute("CREATE TABLE bench.tel (flight_id uuid NOT NULL, ts timestamptz NOT NULL, vendor_field_id smallint NOT NULL, value float8 NOT NULL)")
    conn.execute(f"SELECT create_hypertable('bench.tel', by_range('ts', INTERVAL '{interval}'))")
    if compress:
        opts = f"timescaledb.enable_columnstore = true, timescaledb.orderby = '{order}'" + (f", timescaledb.segmentby = '{seg}'" if seg else "")
        conn.execute(f"ALTER TABLE bench.tel SET ({opts})")
    t0 = time.time()
    conn.execute("INSERT INTO bench.tel SELECT * FROM bench.tel_src")
    load_s = time.time() - t0
    comp_s = None
    if compress:
        t0 = time.time()
        for (c,) in conn.execute("SELECT format('%I.%I', chunk_schema, chunk_name) FROM timescaledb_information.chunks WHERE hypertable_schema='bench' AND hypertable_name='tel'").fetchall():
            conn.execute("SELECT compress_chunk(%s::regclass)", (c,))
        comp_s = time.time() - t0
        total = conn.execute("SELECT after_compression_total_bytes FROM hypertable_columnstore_stats('bench.tel')").fetchone()[0]
    else:
        conn.execute("CREATE INDEX tel_idx ON bench.tel (flight_id, vendor_field_id, ts DESC)")
        total = conn.execute("SELECT hypertable_size('bench.tel')").fetchone()[0]
    chunks = conn.execute("SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_schema='bench' AND hypertable_name='tel'").fetchone()[0]
    conn.execute("ANALYZE bench.tel")
    row = {"variant": label, "chunk_interval": interval, "chunks": chunks, "size_mb": total / 1e6, "bytes_per_row": total / ROWS, "load_s": load_s, "compress_s": comp_s}
    for qn, (sql, prm) in QUERIES.items():
        row[qn] = dict(zip(("p50_ms", "p95_ms"), median_ms(sql, prm)))
    results.append(row)
    print(f"{label[:62]:<62} {row['size_mb']:8.0f} MB {row['bytes_per_row']:6.1f} B/row  " + "  ".join(f"{qn[:2]} {row[qn]['p50_ms']:8.1f}" for qn in QUERIES), flush=True)

conn.execute("DROP TABLE IF EXISTS bench.tel, bench.tel_src CASCADE")
meta = {"taken_at": datetime.now(timezone.utc).isoformat(), "rows": ROWS, "flights": len(ids), "runs": a.runs, "median_of": a.runs,
        "versions": dict(conn.execute("SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb'").fetchall())}
os.makedirs(a.out_dir, exist_ok=True)
json.dump({"meta": meta, "results": results}, open(f"{a.out_dir}/columnstore_{ROWS}.json", "w"), indent=1)
md = [f"# Columnstore physical design, {ROWS:,} rows from {len(ids)} flights", "",
      f"Median of {a.runs} warm runs per query. TimescaleDB {meta['versions'].get('timescaledb')}. Queries: " + "; ".join(QUERIES), "",
      "| variant | chunks | size | bytes/row | compress time | " + " | ".join(q.split(" ")[0] + " p50" for q in QUERIES) + " |", "|---|---|---|---|---|" + "---|" * len(QUERIES)]
for r in results:
    md.append(f"| {r['variant']} | {r['chunks']} | {r['size_mb']:.0f} MB | {r['bytes_per_row']:.1f} | {('%.0f s' % r['compress_s']) if r['compress_s'] else 'n/a'} | " + " | ".join(f"{r[q]['p50_ms']:.1f} ms" for q in QUERIES) + " |")
open(f"{a.out_dir}/columnstore_{ROWS}.md", "w").write("\n".join(md) + "\n")
print(f"wrote {a.out_dir}/columnstore_{ROWS}.md")
