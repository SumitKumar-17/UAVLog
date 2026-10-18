"""Extract events for every flight that has none yet (stage 'events'). Same guarantees as ingest:
idempotent, concurrent-safe, failure-isolated, retried, crash-recoverable, expands automatically with new flights."""
import argparse
import multiprocessing as mp
import socket
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from app import jobs
from app.config import settings
from app.events.rules import rule_events
from app.events.ulog_events import extract

STAGE = "events"


def write(conn, flight_id, events, kind_ids) -> dict:
    """Replace the flight's events and mark the task done in one transaction."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM event WHERE flight_id = %s", (flight_id,))
        cur.executemany(
            "INSERT INTO event (flight_id, kind_id, ts_start, ts_end, severity, source, attrs, description) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            [(flight_id, kind_ids[e["kind"]], e["ts_start"], e["ts_end"], e["severity"], e["source"],
              Jsonb(e["attrs"]), e["description"]) for e in events])
        counts = dict(Counter(e["kind"] for e in events))
        jobs.done(cur, flight_id, STAGE, {"events": len(events), "by_kind": counts})
    return counts


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ulg-dir", default=f"{settings.data_dir}/raw/ulg")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--max-attempts", type=int, default=3)
    p.add_argument("--retry-failed", action="store_true")
    a = p.parse_args()

    worker = f"{socket.gethostname()}:{mp.current_process().pid}"
    # autocommit: otherwise a prior read opens an implicit tx and conn.transaction() degrades to a savepoint
    conn = psycopg.connect(settings.dsn, options="-c timezone=UTC", autocommit=True)
    kind_ids = dict(conn.execute("SELECT key, id FROM concept WHERE kind = 'event'").fetchall())
    if a.retry_failed:
        conn.execute("UPDATE flight_task SET status='pending', attempts=0 WHERE stage=%s AND status='failed'", (STAGE,))
        conn.commit()
    print(f"enqueued {jobs.enqueue(conn, STAGE)} new tasks", flush=True)

    new_pool = lambda: ProcessPoolExecutor(a.workers, mp_context=mp.get_context("spawn"), max_tasks_per_child=100)  # noqa: E731
    pool, claimed, total, t_start = new_pool(), 0, Counter(), time.time()
    while not a.limit or claimed < a.limit:
        n = a.workers * 4 if not a.limit else min(a.workers * 4, a.limit - claimed)
        ids = jobs.claim(conn, STAGE, worker, n, max_attempts=a.max_attempts)
        if not ids:
            break
        claimed += len(ids)
        info = {r[0]: r for r in conn.execute("SELECT id, source_ref, started_at FROM flight WHERE id = ANY(%s)", (ids,))}
        futures = {}
        for fid in ids:
            _, ref, started_at = info[fid]
            path = Path(a.ulg_dir) / f"{ref}.ulg"
            if not path.exists():
                jobs.fail(conn, fid, STAGE, "log file missing", a.max_attempts)
                continue
            futures[pool.submit(extract, str(path), started_at)] = fid
        broken = False
        for fut in as_completed(futures):
            fid = futures[fut]
            try:
                events = fut.result() + rule_events(conn, fid)
                total.update(write(conn, fid, events, kind_ids))
            except BrokenProcessPool:
                broken = True
                jobs.fail(conn, fid, STAGE, "worker process died", a.max_attempts)
            except Exception as e:  # noqa: BLE001 - isolate every per-flight failure
                conn.rollback()
                jobs.fail(conn, fid, STAGE, f"{type(e).__name__}: {e}", a.max_attempts)
                print(f"FAIL {str(info[fid][1])[:8]} {type(e).__name__}: {e}", flush=True)
        if broken:
            pool.shutdown(wait=False, cancel_futures=True)
            pool = new_pool()
        print(f"{claimed} flights done ({time.time() - t_start:.0f}s)", flush=True)
    pool.shutdown()
    print("events by kind:", dict(total.most_common()))
    for status, c in conn.execute("SELECT status, count(*) FROM flight_task WHERE stage=%s GROUP BY 1 ORDER BY 1", (STAGE,)):
        print(f"  {status}: {c}")


if __name__ == "__main__":
    main()
