"""Does 'find similar moments' find moments that share an event kind? Precision at 10 against the base rate, exact against HNSW.

For every event kind that occurs in at least 15 flights: take up to 60 query windows (one per flight) that overlap an event of that kind, search the
windows of all other flights, and count how many of the 10 results overlap an event of the same kind. The base rate is the share of such windows
among all other-flight windows, i.e. what random results would score. Not a ground truth for 'similar behaviour', but a measurable proxy.

  python scripts/eval_moments.py
"""
import json
import random
import time
from datetime import datetime, timezone

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.config import settings

OUT, K, MIN_FLIGHTS, MAX_QUERIES = "/bench/results", 10, 15, 60
conn = psycopg.connect(settings.dsn, autocommit=True)
register_vector(conn)
conn.execute("SET statement_timeout = 0")

W = conn.execute("SELECT flight_id, t0, embedding FROM signal_window ORDER BY flight_id, t0").fetchall()
fl = np.array([str(r[0]) for r in W])
T0 = np.array([r[1] for r in W])
E = np.array([r[2].to_numpy() for r in W], dtype=np.float32)
index = {(str(r[0]), float(r[1])): i for i, r in enumerate(W)}
labels = [set() for _ in W]
for fid, t0, kind in conn.execute("""
    SELECT w.flight_id, w.t0, c.key FROM signal_window w JOIN flight f ON f.id = w.flight_id JOIN event e ON e.flight_id = w.flight_id
    JOIN concept c ON c.id = e.kind_id
    WHERE extract(epoch FROM e.ts_start - f.started_at) < w.t1 AND extract(epoch FROM coalesce(e.ts_end, e.ts_start) - f.started_at) >= w.t0""").fetchall():
    labels[index[(str(fid), float(t0))]].add(kind)
kinds = sorted({k for s in labels for k in s})
print(f"{len(W):,} windows of {len(set(fl))} flights; {sum(1 for s in labels if s):,} windows overlap an event", flush=True)

rows, rng = [], random.Random(5)
for kind in kinds:
    members = [i for i, s in enumerate(labels) if kind in s]
    flights_with = sorted({fl[i] for i in members})
    if len(flights_with) < MIN_FLIGHTS:
        continue
    by_flight = {}
    for i in members:
        by_flight.setdefault(fl[i], []).append(i)
    queries = [rng.choice(v) for f, v in sorted(by_flight.items())]
    rng.shuffle(queries)
    queries = queries[:MAX_QUERIES]
    p_exact, p_hnsw, overlap, lat, base, short = [], [], [], [], [], []
    for qi in queries:
        other = fl != fl[qi]
        base.append(np.mean([kind in labels[j] for j in np.flatnonzero(other)]))
        d = 1 - E[other] @ E[qi]
        ids = np.flatnonzero(other)[np.argsort(d)[:K]]
        p_exact.append(np.mean([kind in labels[j] for j in ids]))
        conn.execute("SET hnsw.iterative_scan = off")  # the default: the index returns its nearest candidates, then the flight filter is applied
        short.append(len(conn.execute("SELECT 1 FROM signal_window WHERE flight_id <> %s ORDER BY embedding <=> %s LIMIT %s", (fl[qi], E[qi], K)).fetchall()) < K)
        conn.execute("SET hnsw.iterative_scan = relaxed_order")
        t = time.perf_counter()
        got = conn.execute("""SELECT flight_id, t0 FROM signal_window WHERE flight_id <> %s ORDER BY embedding <=> %s LIMIT %s""", (fl[qi], E[qi], K)).fetchall()
        lat.append((time.perf_counter() - t) * 1000)
        hid = [index[(str(f), float(t0))] for f, t0 in got]
        p_hnsw.append(np.mean([kind in labels[j] for j in hid]))
        overlap.append(len(set(hid) & set(ids.tolist())) / K)
    rows.append({"kind": kind, "flights": len(flights_with), "windows": len(members), "queries": len(queries), "base_rate": float(np.mean(base)),
                 "precision_exact": float(np.mean(p_exact)), "precision_hnsw": float(np.mean(p_hnsw)), "hnsw_recall": float(np.mean(overlap)),
                 "hnsw_p50_ms": float(np.median(lat)), "short_without_iterative_scan": float(np.mean(short))})
    r = rows[-1]
    print(f"{kind:28s} q={r['queries']:3d} base={r['base_rate']:.3f} exact={r['precision_exact']:.3f} hnsw={r['precision_hnsw']:.3f} lift={r['precision_exact'] / max(r['base_rate'], 1e-9):.1f}x", flush=True)

mean = lambda k: float(np.mean([r[k] for r in rows]))
res = {"taken_at": datetime.now(timezone.utc).isoformat(), "windows": len(W), "flights": int(len(set(fl))), "k": K, "kinds": rows,
       "mean_base_rate": mean("base_rate"), "mean_precision_exact": mean("precision_exact"), "mean_precision_hnsw": mean("precision_hnsw"),
       "mean_hnsw_recall": mean("hnsw_recall"), "mean_hnsw_p50_ms": mean("hnsw_p50_ms"), "mean_short_without_iterative_scan": mean("short_without_iterative_scan")}
md = [f"# Similar moments: precision at {K} by event kind", "",
      f"{len(W):,} ten-second windows of {res['flights']} flights, 32-dimension window embeddings. For each kind that occurs in at least {MIN_FLIGHTS} flights, up to {MAX_QUERIES} query windows (one per flight) that overlap an event of that kind; a result counts when it overlaps an event of the same kind. Base rate is what random results would score.", "",
      "| event kind | flights | queries | base rate | precision (exact) | precision (HNSW) | lift | HNSW recall vs exact | HNSW p50 ms | queries returning fewer than 10 rows without iterative scan |", "|---|---|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append(f"| {r['kind'].replace('_', ' ')} | {r['flights']} | {r['queries']} | {r['base_rate']:.3f} | {r['precision_exact']:.3f} | {r['precision_hnsw']:.3f} | {r['precision_exact'] / max(r['base_rate'], 1e-9):.1f}x | {r['hnsw_recall']:.2f} | {r['hnsw_p50_ms']:.1f} | {r['short_without_iterative_scan']:.0%} |")
md += ["", f"Mean over kinds: base rate {res['mean_base_rate']:.3f}, precision {res['mean_precision_exact']:.3f} (exact) and {res['mean_precision_hnsw']:.3f} (HNSW), HNSW recall {res['mean_hnsw_recall']:.2f}, p50 {res['mean_hnsw_p50_ms']:.1f} ms (HNSW with iterative scan). Without iterative scan {res['mean_short_without_iterative_scan']:.0%} of queries returned fewer than {K} rows, because the nearest windows are the neighbouring windows of the query's own flight and the filter removes them after the index scan: the filtered-search pitfall measured earlier, on real data."]
open(f"{OUT}/moments_eval.json", "w").write(json.dumps(res, indent=1))
open(f"{OUT}/moments_eval.md", "w").write("\n".join(md) + "\n")
print("wrote moments_eval.md", flush=True)
