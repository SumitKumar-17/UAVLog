"""Measure storage footprint and project it to larger corpora. Writes JSON + prints a markdown table."""
import argparse
import json
import os
from datetime import datetime, timezone

import psycopg

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--label", default="snapshot")
p.add_argument("--out-dir", default="/bench/results")
p.add_argument("--scales", default="300,1000,10000,76365,478918", help="flight counts to project to")
a = p.parse_args()


def dir_bytes(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    return total


with psycopg.connect(settings.dsn) as c:
    flights, rows = c.execute("SELECT (SELECT count(*) FROM flight), (SELECT count(*) FROM telemetry)").fetchone()
    db_total = c.execute("SELECT pg_database_size(current_database())").fetchone()[0]
    tbl, idx, toast, tot = c.execute("SELECT table_bytes, index_bytes, toast_bytes, total_bytes "
                                     "FROM hypertable_detailed_size('telemetry')").fetchone()
    chunks = c.execute("SELECT count(*), count(*) FILTER (WHERE is_compressed) FROM timescaledb_information.chunks "
                       "WHERE hypertable_name='telemetry'").fetchone()
    other = db_total - tot

parquet = dir_bytes(f"{settings.data_dir}/parquet")
ulg = dir_bytes(f"{settings.data_dir}/raw/ulg")
per = {"rows": rows / flights, "telemetry_bytes": tot / flights, "db_bytes": db_total / flights,
       "parquet_bytes": parquet / flights, "ulg_bytes": ulg / flights}

report = {
    "label": a.label, "taken_at": datetime.now(timezone.utc).isoformat(), "flights": flights, "telemetry_rows": rows,
    "bytes": {"db_total": db_total, "telemetry_total": tot, "telemetry_table": tbl, "telemetry_index": idx,
              "telemetry_toast": toast, "other_tables": other, "parquet": parquet, "ulg_raw": ulg},
    "chunks": {"total": chunks[0], "compressed": chunks[1]},
    "per_flight": per, "bytes_per_row_telemetry": tot / rows,
    "projection": {str(n): {"db_gb": per["db_bytes"] * n / 1e9, "parquet_gb": per["parquet_bytes"] * n / 1e9,
                            "ulg_gb": per["ulg_bytes"] * n / 1e9, "rows_millions": per["rows"] * n / 1e6}
                   for n in map(int, a.scales.split(","))},
}
os.makedirs(a.out_dir, exist_ok=True)
with open(f"{a.out_dir}/size_{a.label}.json", "w") as f:
    json.dump(report, f, indent=2)

gb = lambda b: f"{b / 1e9:.2f} GB"  # noqa: E731
print(f"[{a.label}] flights={flights} rows={rows:,} chunks={chunks[0]} (compressed {chunks[1]})")
print(f"  DB {gb(db_total)} = telemetry {gb(tot)} (table {gb(tbl)} + index {gb(idx)}) + other {gb(other)}")
print(f"  Parquet {gb(parquet)}, raw ulg {gb(ulg)}; telemetry {tot / rows:.0f} bytes/row")
print("\n| flights | rows (M) | DB GB | Parquet GB | raw ulg GB |\n|---|---|---|---|---|")
for n, v in report["projection"].items():
    print(f"| {int(n):,} | {v['rows_millions']:,.0f} | {v['db_gb']:,.0f} | {v['parquet_gb']:,.0f} | {v['ulg_gb']:,.0f} |")
