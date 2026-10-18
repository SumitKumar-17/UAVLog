"""Create the vector benchmark dataset in schema `bench`: N event-like vectors scaled up from the real corpus.

Real event embeddings (with their real kind, severity and board) are sampled with replacement and perturbed
(x = normalise(v + sigma * unit_noise), so cosine to the source is about 1/sqrt(1+sigma^2)). This keeps the cluster structure and
the attribute skew of the real data at a size where index choice matters. Limitation: perturbed copies are not new text.
`bucket` is uniform in [0, 10000) and independent of the vector, giving exactly controlled filter selectivity.
Held-out queries are separate perturbations of real events, with the source event's kind and board kept for correlated filters.

  python scripts/bench_vectors.py --n 100000
"""
import argparse
import time

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--n", type=int, default=100_000)
p.add_argument("--queries", type=int, default=200)
p.add_argument("--sigma", type=float, default=0.35)
p.add_argument("--seed", type=int, default=7)
a = p.parse_args()
rng = np.random.default_rng(a.seed)

with psycopg.connect(settings.dsn, autocommit=True) as c:
    register_vector(c)
    rows = c.execute("SELECT e.embedding, e.kind_id, e.severity, coalesce(f.metadata->>'sys_hw', 'unknown') "
                     "FROM event e JOIN flight f ON f.id = e.flight_id WHERE e.embedding IS NOT NULL").fetchall()
    base = np.stack([r[0].to_numpy() if hasattr(r[0], "to_numpy") else np.asarray(r[0]) for r in rows]).astype(np.float32)
    kind, sev, board = np.array([r[1] for r in rows]), np.array([r[2] for r in rows]), [r[3] for r in rows]
    print(f"{len(rows)} real events, dimension {base.shape[1]}")
    # difficulty of the REAL corpus: median relative contrast RC10 = mean distance / 10th-neighbour distance (cosine distance),
    # leave-one-out. Exact duplicates (repeated log lines) make the 10th neighbour distance 0, which is counted separately.
    sub = base[np.random.default_rng(1).choice(len(base), 500, replace=False)]
    dist = 1 - sub @ base.T
    dist[np.arange(500), np.argmax(sub @ base.T, axis=1)] = np.inf  # drop the point itself
    d10 = np.sort(dist, axis=1)[:, 9]
    mean_d = np.nanmean(np.where(np.isinf(dist), np.nan, dist), axis=1)
    dup = float(np.mean(d10 < 1e-6))
    rc_real = float(np.median(mean_d[d10 >= 1e-6] / d10[d10 >= 1e-6]))
    print(f"real corpus difficulty: median RC10 {rc_real:.1f} over queries with a non-duplicate 10th neighbour; {100 * dup:.0f}% of queries have 10 exact duplicates")

    def perturb(idx):
        v = base[idx]
        noise = rng.standard_normal(v.shape).astype(np.float32)
        noise /= np.linalg.norm(noise, axis=1, keepdims=True)
        x = v + a.sigma * noise
        return x / np.linalg.norm(x, axis=1, keepdims=True)

    c.execute("DROP SCHEMA IF EXISTS bench CASCADE")
    c.execute("CREATE SCHEMA bench")
    c.execute("""CREATE TABLE bench.event_vec (id bigint PRIMARY KEY, kind_id int NOT NULL, severity smallint NOT NULL, board text NOT NULL,
                 flight int NOT NULL, bucket int NOT NULL, embedding vector(%d) NOT NULL)""" % base.shape[1])
    c.execute("CREATE TABLE bench.meta (key text PRIMARY KEY, value text)")
    c.execute("INSERT INTO bench.meta VALUES ('sigma', %s), ('seed', %s), ('real_rc10', %s), ('real_dup_fraction', %s)", (str(a.sigma), str(a.seed), f"{rc_real:.2f}", f"{dup:.3f}"))
    c.execute("CREATE TABLE bench.query_vec (qid int PRIMARY KEY, kind_id int NOT NULL, board text NOT NULL, embedding vector(%d) NOT NULL)" % base.shape[1])

    t0, chunk, next_id = time.time(), 5000, 0
    n_flights = max(a.n // 11, 1)
    with c.cursor() as cur, cur.copy("COPY bench.event_vec (id, kind_id, severity, board, flight, bucket, embedding) FROM STDIN WITH (FORMAT BINARY)") as cp:
        cp.set_types(["int8", "int4", "int2", "text", "int4", "int4", "vector"])
        while next_id < a.n:
            m = min(chunk, a.n - next_id)
            idx = rng.integers(0, len(rows), m)
            x = perturb(idx)
            for j in range(m):
                i = idx[j]
                cp.write_row((next_id + j, int(kind[i]), int(sev[i]), board[i], int(rng.integers(0, n_flights)), int(rng.integers(0, 10_000)), x[j]))
            next_id += m
    print(f"loaded {a.n} vectors in {time.time() - t0:.0f}s")

    qidx = rng.integers(0, len(rows), a.queries)
    qx = perturb(qidx)
    with c.cursor() as cur:
        for q in range(a.queries):
            cur.execute("INSERT INTO bench.query_vec VALUES (%s, %s, %s, %s)", (q, int(kind[qidx[q]]), board[qidx[q]], qx[q]))
    c.execute("ANALYZE bench.event_vec")
    size = c.execute("SELECT pg_size_pretty(pg_total_relation_size('bench.event_vec'))").fetchone()[0]
    print(f"{a.queries} queries; table size {size}")
    for k, n in c.execute("SELECT kind_id, count(*) FROM bench.event_vec GROUP BY 1 ORDER BY 2 DESC LIMIT 4"):
        print(f"  kind {k}: {n} rows ({100 * n / a.n:.2f}%)")
