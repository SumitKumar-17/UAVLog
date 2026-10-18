"""Embed event descriptions (stage 'embed_events'). Same guarantees as the other stages. Identical texts across
flights are embedded once per round (many log messages repeat), which cuts API cost."""
import argparse
import multiprocessing as mp
import socket
import time

import psycopg

from app import jobs
from app.config import settings
from app.llm import LLMClient

STAGE = "embed_events"


def text_of(kind: str, description: str) -> str:
    return f"{kind.replace('_', ' ')}: {description}"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--flights-per-round", type=int, default=25)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--max-attempts", type=int, default=3)
    p.add_argument("--retry-failed", action="store_true")
    a = p.parse_args()

    worker = f"{socket.gethostname()}:{mp.current_process().pid}"
    conn = psycopg.connect(settings.dsn, autocommit=True)
    llm = LLMClient(conn)
    if a.retry_failed:
        conn.execute("UPDATE flight_task SET status='pending', attempts=0 WHERE stage=%s AND status='failed'", (STAGE,))
    print(f"enqueued {jobs.enqueue(conn, STAGE)} new tasks", flush=True)

    claimed, embedded, t_start = 0, 0, time.time()
    while not a.limit or claimed < a.limit:
        n = a.flights_per_round if not a.limit else min(a.flights_per_round, a.limit - claimed)
        ids = jobs.claim(conn, STAGE, worker, n, max_attempts=a.max_attempts)
        if not ids:
            break
        claimed += len(ids)
        try:
            rows = conn.execute(
                "SELECT e.id, e.flight_id, c.key, e.description FROM event e JOIN concept c ON c.id = e.kind_id "
                "WHERE e.flight_id = ANY(%s) AND e.embedding IS NULL", (ids,)).fetchall()
            texts = sorted({text_of(k, d) for _, _, k, d in rows})
            vec = dict(zip(texts, llm.embed(texts))) if texts else {}
            by_flight: dict = {}
            for eid, fid, k, d in rows:
                by_flight.setdefault(fid, []).append((eid, vec[text_of(k, d)]))
            for fid in ids:
                with conn.transaction(), conn.cursor() as cur:
                    cur.executemany("UPDATE event SET embedding = %s::vector, embedding_model = %s WHERE id = %s",
                                    [(str(v), settings.embed_model, eid) for eid, v in by_flight.get(fid, [])])
                    jobs.done(cur, fid, STAGE, {"embedded": len(by_flight.get(fid, []))})
            embedded += len(rows)
            print(f"{claimed} flights, {embedded} events embedded, {len(texts)} unique texts this round "
                  f"({time.time() - t_start:.0f}s)", flush=True)
        except Exception as e:  # noqa: BLE001 - a failed round is retried per flight, never aborts the run
            for fid in ids:
                jobs.fail(conn, fid, STAGE, f"{type(e).__name__}: {e}", a.max_attempts)
            print(f"FAIL round: {type(e).__name__}: {e}", flush=True)
    for status, c in conn.execute("SELECT status, count(*) FROM flight_task WHERE stage=%s GROUP BY 1 ORDER BY 1", (STAGE,)):
        print(f"  {status}: {c}")
    tok, calls = conn.execute("SELECT coalesce(sum(prompt_tokens),0), count(*) FROM llm_call WHERE kind='embedding'").fetchone()
    print(f"llm_call log: {calls} calls, {tok} embedding tokens total")


if __name__ == "__main__":
    main()
