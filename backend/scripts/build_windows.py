"""Embed 10 second windows of every flight by how the signals behaved (for 'find similar moments').

Follows the pipeline rules: a per-flight task (flight_task, stage 'windows') claimed with SKIP LOCKED, idempotent, atomic per flight (the
windows and the task status commit together), retried, resumable, and workers can run side by side. The scaler and PCA are fitted once on a
sample of flights and stored in window_model, so flights added later are embedded without refitting.

  python scripts/build_windows.py [--workers 4] [--fit-flights 80]
"""
import argparse
import json
import multiprocessing as mp
import os
import random
import time
import traceback

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app import jobs, windows
from app.config import settings

STAGE = "windows"
p = argparse.ArgumentParser()
p.add_argument("--workers", type=int, default=4)
p.add_argument("--fit-flights", type=int, default=80)
a = p.parse_args()


def connect():
    c = psycopg.connect(settings.dsn)
    register_vector(c)
    c.execute("SET statement_timeout = 0")
    c.commit()
    return c


def ensure_model(conn) -> dict:
    conn.execute("SELECT pg_advisory_lock(80080)")
    try:
        row = conn.execute("SELECT model FROM window_model WHERE id = 1").fetchone()
        if row:
            return row[0]
        n = conn.execute("SELECT count(*) FROM flight").fetchone()[0]
        signals = sorted(r[0] for r in conn.execute(
            """SELECT signal FROM semantic.signal_summary GROUP BY signal HAVING count(*) >= %s
               AND signal NOT LIKE 'mode.%%' AND signal NOT IN ('gps.lat', 'gps.lon')""", (0.3 * n,)).fetchall())
        flights = [r[0] for r in conn.execute("SELECT id FROM flight WHERE duration_s > 60 AND autopilot = 'px4'").fetchall()]
        random.Random(7).shuffle(flights)
        rows = []
        for fid in flights[:a.fit_flights]:
            dur = conn.execute("SELECT duration_s FROM flight WHERE id = %s", (fid,)).fetchone()[0]
            series = windows.load_series(conn, fid, signals)
            starts = windows.window_starts(dur)
            random.Random(fid.int).shuffle(starts)
            rows += [windows.window_features(series, signals, t0) for t0 in starts[:60]]
        X = np.array(rows)
        model = windows.fit(X, signals)
        conn.execute("INSERT INTO window_model (id, model) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, fitted_at = now()",
                     (json.dumps(model),))
        conn.commit()
        print(f"fitted on {len(X)} windows of {min(len(flights), a.fit_flights)} flights, {len(signals)} signals, "
              f"PCA keeps {100 * model['explained_variance']:.0f}% of the variance", flush=True)
        return model
    finally:
        conn.execute("SELECT pg_advisory_unlock(80080)")


def work(i: int) -> tuple[int, int]:
    conn = connect()
    model = ensure_model(conn)
    signals = model["signals"]
    worker, ok, bad = f"windows-{os.getpid()}", 0, 0
    while True:
        ids = jobs.claim(conn, STAGE, worker, 1)
        if not ids:
            return ok, bad
        fid = ids[0]
        try:
            dur = conn.execute("SELECT duration_s FROM flight WHERE id = %s", (fid,)).fetchone()[0] or 0
            series = windows.load_series(conn, fid, signals)
            starts, feats = [], []
            for t0 in windows.window_starts(dur):
                x = windows.window_features(series, signals, t0)
                if np.isfinite(x[::len(windows.STATS)]).mean() >= windows.MIN_SIGNAL_SHARE:
                    starts.append(t0)
                    feats.append(x)
            emb = windows.transform(model, np.array(feats)) if feats else np.zeros((0, windows.DIMS), dtype=np.float32)
            with conn.cursor() as cur:
                cur.execute("DELETE FROM signal_window WHERE flight_id = %s", (fid,))
                cur.executemany("INSERT INTO signal_window (flight_id, t0, t1, embedding) VALUES (%s, %s, %s, %s)",
                                [(fid, t0, t0 + windows.WINDOW_S, emb[j]) for j, t0 in enumerate(starts)])
                jobs.done(cur, fid, STAGE, {"windows": len(starts)})
            conn.commit()
            ok += 1
        except Exception:
            conn.rollback()
            jobs.fail(conn, fid, STAGE, traceback.format_exc())
            bad += 1


if __name__ == "__main__":
    t0 = time.time()
    conn = connect()
    ensure_model(conn)
    print(f"enqueued {jobs.enqueue(conn, STAGE)} flights", flush=True)
    with mp.get_context("spawn").Pool(a.workers) as pool:
        res = pool.map(work, range(a.workers))
    print(f"done: {sum(r[0] for r in res)} flights embedded, {sum(r[1] for r in res)} failed, {time.time() - t0:.0f} s", flush=True)
    conn.autocommit = True
    conn.execute("CREATE INDEX IF NOT EXISTS signal_window_hnsw ON signal_window USING hnsw (embedding vector_cosine_ops)")
    conn.execute("ANALYZE signal_window")
    n, = conn.execute("SELECT count(*) FROM signal_window").fetchone()
    print(f"{n:,} windows indexed", flush=True)
