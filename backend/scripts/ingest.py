"""Claim and process ingest jobs. Safe to re-run and to run concurrently (SKIP LOCKED).

Failures are isolated per log and retried up to --max-attempts; a dead worker (e.g. OOM) is survived;
stale 'running' jobs from a crashed run are reclaimed after --lease-min minutes.
"""
import argparse
import io
import json
import multiprocessing as mp
import socket
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

import numpy as np
import psycopg
import pyarrow as pa
import pyarrow.csv as pacsv

from app.config import settings
from app.ingest.ulog import process

CLAIM = """
UPDATE ingest_job SET status='running', attempts=attempts+1, claimed_at=now(), worker=%(worker)s
WHERE log_id IN (
    SELECT log_id FROM ingest_job
    WHERE (status='pending' OR (status='running' AND claimed_at < now() - make_interval(mins => %(lease)s)))
      AND attempts < %(max)s
    ORDER BY created_at, log_id LIMIT %(n)s FOR UPDATE SKIP LOCKED)
RETURNING log_id, payload, attempts"""


def telemetry_table(r: dict, vf_ids: dict, fid: str) -> pa.Table | None:
    t0_us = np.datetime64(r["t0"].replace(tzinfo=None), "us")
    parts = []
    for topic, field, ts_us, vals in r["hot"]:
        ok = np.isfinite(vals)
        parts.append(pa.table({
            "ts": pa.array(t0_us + ts_us[ok].astype("timedelta64[us]"), pa.timestamp("us")),
            "vf": pa.array(np.full(int(ok.sum()), vf_ids[(topic, field)], np.int16)),
            "value": vals[ok],
        }))
    if not parts:
        return None
    t = pa.concat_tables(parts)
    return t.add_column(0, "flight_id", pa.repeat(pa.scalar(fid), t.num_rows))


def load(conn, vf_ids, r) -> int:
    """Insert flight + telemetry and mark the job done in ONE transaction."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """INSERT INTO flight (source, source_ref, autopilot, firmware, vehicle_type, started_at,
               duration_s, log_sha256, parquet_path, metadata)
               VALUES ('flight_review', %s, 'px4', %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (log_sha256) DO NOTHING RETURNING id""",
            (r["log_id"], r["firmware"], r["vehicle_type"], r["t0"], r["duration_s"], r["sha256"],
             r["parquet_path"], json.dumps(r["metadata"], default=str)),
        )
        row, n = cur.fetchone(), 0
        if row is not None:  # None = identical log content already loaded under another id
            t = telemetry_table(r, vf_ids, str(row[0]))
            if t is not None:
                n = t.num_rows
                with cur.copy("COPY telemetry (flight_id, ts, vendor_field_id, value) FROM STDIN (FORMAT csv)") as cp:
                    for off in range(0, n, 1_000_000):
                        buf = io.BytesIO()
                        pacsv.write_csv(t.slice(off, 1_000_000), buf, pacsv.WriteOptions(include_header=False))
                        cp.write(buf.getvalue())
        cur.execute(
            "UPDATE ingest_job SET status='done', finished_at=now(), rows_loaded=%s, elapsed_s=%s, last_error=NULL "
            "WHERE log_id=%s", (n, r["elapsed_s"], r["log_id"]))
    return n


def fail(conn, log_id: str, err: str, max_attempts: int, status: str | None = None) -> None:
    conn.execute(
        """UPDATE ingest_job SET last_error=%s, finished_at=now(),
           status = COALESCE(%s, CASE WHEN attempts >= %s THEN 'failed' ELSE 'pending' END)
           WHERE log_id=%s""", (err[:2000], status, max_attempts, log_id))
    conn.commit()


def run_one(ulg_dir: str, parquet_dir: str, rec: dict) -> dict:
    start = time.time()
    r = process(f"{ulg_dir}/{rec['log_id']}.ulg", rec, parquet_dir)
    r["elapsed_s"] = time.time() - start
    return r


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ulg-dir", default=f"{settings.data_dir}/raw/ulg")
    p.add_argument("--parquet-dir", default=f"{settings.data_dir}/parquet")
    p.add_argument("--limit", type=int, default=0, help="stop after claiming this many jobs; 0 = until queue empty")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--max-attempts", type=int, default=3)
    p.add_argument("--lease-min", type=int, default=30)
    p.add_argument("--retry-failed", action="store_true", help="reset failed jobs to pending first")
    a = p.parse_args()

    worker = f"{socket.gethostname()}:{mp.current_process().pid}"
    conn = psycopg.connect(settings.dsn, options="-c timezone=UTC")
    vf_ids = {(t, f): i for i, t, f in conn.execute("SELECT id, topic, field FROM vendor_field WHERE autopilot='px4'")}
    if a.retry_failed:
        conn.execute("UPDATE ingest_job SET status='pending', attempts=0 WHERE status='failed'")
        conn.commit()

    def new_pool():
        return ProcessPoolExecutor(a.workers, mp_context=mp.get_context("spawn"), max_tasks_per_child=25)

    pool, claimed, t_start = new_pool(), 0, time.time()
    while not a.limit or claimed < a.limit:
        n = a.workers * 2 if not a.limit else min(a.workers * 2, a.limit - claimed)
        jobs = conn.execute(CLAIM, {"worker": worker, "lease": a.lease_min, "max": a.max_attempts, "n": n}).fetchall()
        conn.commit()
        if not jobs:
            break
        claimed += len(jobs)
        futures = {}
        for log_id, payload, _ in jobs:
            if not Path(f"{a.ulg_dir}/{log_id}.ulg").exists():
                fail(conn, log_id, "log file not downloaded", a.max_attempts, status="missing")
                continue
            futures[pool.submit(run_one, a.ulg_dir, a.parquet_dir, payload)] = log_id
        broken = False
        for fut in as_completed(futures):
            log_id = futures[fut]
            try:
                r = fut.result()
                rows = load(conn, vf_ids, r)
                print(f"ok   {log_id[:8]} {r['duration_s']:.0f}s flight, {r['topics']} topics, {rows} rows, "
                      f"{r['elapsed_s']:.1f}s parse ({time.time() - t_start:.0f}s elapsed)", flush=True)
            except BrokenProcessPool:
                broken = True
                fail(conn, log_id, "worker process died (possible out-of-memory)", a.max_attempts)
                print(f"FAIL {log_id[:8]} worker died", flush=True)
            except Exception as e:  # noqa: BLE001 - isolate every per-log failure
                conn.rollback()
                fail(conn, log_id, f"{type(e).__name__}: {e}", a.max_attempts)
                print(f"FAIL {log_id[:8]} {type(e).__name__}: {e}", flush=True)
        if broken:
            pool.shutdown(wait=False, cancel_futures=True)
            pool = new_pool()

    pool.shutdown()
    print(f"finished in {time.time() - t_start:.0f}s; queue status:")
    for status, n in conn.execute("SELECT status, count(*) FROM ingest_job GROUP BY 1 ORDER BY 1"):
        print(f"  {status}: {n}")


if __name__ == "__main__":
    main()
