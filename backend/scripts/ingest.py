"""Claim and process ingest jobs. Safe to re-run and to run concurrently (SKIP LOCKED).

Failures are isolated per log and retried up to --max-attempts; a dead worker (e.g. OOM) is survived;
stale 'running' jobs from a crashed run are reclaimed after --lease-min minutes.
"""
import argparse
import json
import multiprocessing as mp
import socket
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

import psycopg

from app.config import settings
from app.ingest.load import load
from app.ingest.ulog import process

CLAIM = """
WITH c AS MATERIALIZED (
    SELECT log_id FROM ingest_job
    WHERE (status='pending' OR (status='running' AND claimed_at < now() - make_interval(mins => %(lease)s)))
      AND attempts < %(max)s
    ORDER BY created_at, log_id LIMIT %(n)s FOR UPDATE SKIP LOCKED)
UPDATE ingest_job j SET status='running', attempts=attempts+1, claimed_at=now(), worker=%(worker)s
FROM c WHERE j.log_id = c.log_id
RETURNING j.log_id, j.payload, j.attempts"""


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
