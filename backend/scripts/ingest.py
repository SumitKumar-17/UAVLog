"""Ingest manifest logs: Parquet raw layer + hot telemetry into the hypertable. Resumable."""
import argparse
import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import psycopg

from app.config import settings
from app.ingest.ulog import process

p = argparse.ArgumentParser()
p.add_argument("--manifest", default=f"{settings.data_dir}/raw/manifest.jsonl")
p.add_argument("--ulg-dir", default=f"{settings.data_dir}/raw/ulg")
p.add_argument("--parquet-dir", default=f"{settings.data_dir}/parquet")
p.add_argument("--limit", type=int, default=0, help="0 = all")
p.add_argument("--workers", type=int, default=2)
a = p.parse_args()


def work(rec):
    return process(f"{a.ulg_dir}/{rec['log_id']}.ulg", rec, a.parquet_dir)


def load(conn, vf_ids, r):
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """INSERT INTO flight (source, source_ref, autopilot, firmware, vehicle_type, started_at,
               duration_s, log_sha256, parquet_path, metadata)
               VALUES ('flight_review', %s, 'px4', %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (log_sha256) DO NOTHING RETURNING id""",
            (r["log_id"], r["firmware"], r["vehicle_type"], r["t0"], r["duration_s"], r["sha256"],
             r["parquet_path"], json.dumps(r["metadata"], default=str)),
        )
        row = cur.fetchone()
        if row is None:
            return 0
        fid, n = str(row[0]), 0
        t0_us = np.datetime64(r["t0"].replace(tzinfo=None), "us")
        with cur.copy("COPY telemetry (flight_id, ts, vendor_field_id, value) FROM STDIN") as cp:
            for topic, field, ts_us, vals in r["hot"]:
                ok = np.isfinite(vals)
                ts = (t0_us + ts_us[ok].astype("timedelta64[us]")).astype(str)
                vf = vf_ids[(topic, field)]
                for t, v in zip(ts, vals[ok]):
                    cp.write_row((fid, t + "+00", vf, float(v)))
                n += int(ok.sum())
        return n


with psycopg.connect(settings.dsn) as conn:
    done = {x[0] for x in conn.execute("SELECT source_ref FROM flight")}
    vf_ids = {(t, f): i for i, t, f in conn.execute("SELECT id, topic, field FROM vendor_field WHERE autopilot='px4'")}
    recs = [json.loads(line) for line in open(a.manifest)]
    recs = [r for r in recs if r["log_id"] not in done and Path(f"{a.ulg_dir}/{r['log_id']}.ulg").exists()]
    if a.limit:
        recs = recs[: a.limit]
    print(f"{len(done)} already ingested, {len(recs)} to do", flush=True)
    t_start = time.time()
    with Pool(a.workers) as pool:
        for i, r in enumerate(pool.imap_unordered(work, recs), 1):
            n = load(conn, vf_ids, r)
            print(f"[{i}/{len(recs)}] {r['log_id'][:8]} {r['duration_s']:.0f}s flight, "
                  f"{r['topics']} topics, {n} telemetry rows ({time.time()-t_start:.0f}s elapsed)", flush=True)
