"""Experiment 2: HNSW vs IVFFlat vs DiskANN on the benchmark vectors (schema `bench`, created by bench_vectors.py).

For each index: build time and size; for each search-time setting: recall@10 against exact search, p50/p95 latency, throughput,
rows actually returned. Exact ground truth is a forced sequential scan. Methodology follows ann-benchmarks (recall against latency or
throughput), single connection, each setting warmed up then measured over several passes.

  python scripts/bench_ann.py --indexes hnsw16,hnsw32,ivf_sqrt,ivf_1000,diskann
"""
import argparse
import json
import math
import os
import time
from datetime import datetime, timezone

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--indexes", default="hnsw16,hnsw32,ivf_sqrt,ivf_1000,diskann")
p.add_argument("--k", type=int, default=10)
p.add_argument("--passes", type=int, default=3)
p.add_argument("--out-dir", default="/bench/results")
p.add_argument("--label", default="")
a = p.parse_args()

conn = psycopg.connect(settings.dsn, autocommit=True)
register_vector(conn)
N = conn.execute("SELECT count(*) FROM bench.event_vec").fetchone()[0]
DIM = conn.execute("SELECT vector_dims(embedding) FROM bench.event_vec LIMIT 1").fetchone()[0]
Q = [(r[0], r[1].to_numpy() if hasattr(r[1], "to_numpy") else np.asarray(r[1])) for r in conn.execute("SELECT qid, embedding FROM bench.query_vec ORDER BY qid")]
K = a.k
conn.execute("SET maintenance_work_mem = '2GB'")
conn.execute("SET max_parallel_maintenance_workers = 3")


def drop_indexes():
    for (name,) in conn.execute("SELECT indexname FROM pg_indexes WHERE schemaname = 'bench' AND tablename = 'event_vec' AND indexname <> 'event_vec_pkey'").fetchall():
        conn.execute(f"DROP INDEX bench.{name}")


def exact_truth() -> dict[int, list[int]]:
    """Exact top-100 per query: sequential scan with every index path disabled."""
    drop_indexes()
    conn.execute("SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_seqscan = on")
    truth, lat, rcs = {}, [], []
    for qid, v in Q:
        t0 = time.perf_counter()
        rows = conn.execute("SELECT id, embedding <=> %s AS d FROM bench.event_vec ORDER BY d LIMIT 100", (v,)).fetchall()
        lat.append((time.perf_counter() - t0) * 1000)
        truth[qid] = [r[0] for r in rows]
        mean_d = conn.execute("SELECT avg(embedding <=> %s) FROM bench.event_vec TABLESAMPLE BERNOULLI (2)", (v,)).fetchone()[0]
        if rows[9][1] > 1e-6:
            rcs.append(mean_d / rows[9][1])
    conn.execute("RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_seqscan")
    global RC10
    RC10 = float(np.median(rcs)) if rcs else float("nan")
    return truth, lat


def run_queries(passes: int):
    """One warm-up pass, then `passes` measured passes. Returns per-query latencies (ms), recalls, rows returned."""
    lats, rec, ret = [], [], []
    for ps in range(passes + 1):
        for qid, v in Q:
            t0 = time.perf_counter()
            ids = [r[0] for r in conn.execute("SELECT id FROM bench.event_vec ORDER BY embedding <=> %s LIMIT %s", (v, K)).fetchall()]
            ms = (time.perf_counter() - t0) * 1000
            if ps == 0:
                continue
            lats.append(ms)
            rec.append(len(set(ids) & set(truth[qid][:K])) / K)
            ret.append(len(ids))
    return lats, rec, ret


def point(label, params, lats, rec, ret):
    return {"index": label, "params": params, "recall": float(np.mean(rec)), "p50_ms": float(np.percentile(lats, 50)), "p95_ms": float(np.percentile(lats, 95)),
            "mean_ms": float(np.mean(lats)), "qps": float(1000 / np.mean(lats)), "rows_returned": float(np.mean(ret))}


def size_mb(idx):
    return conn.execute("SELECT pg_relation_size(%s::regclass)", (f"bench.{idx}",)).fetchone()[0] / 1e6


sq = max(int(round(math.sqrt(N))), 10)
SPECS = {
    "hnsw16": ("HNSW m=16, ef_construction=64", "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)",
               [("hnsw.ef_search", v) for v in (10, 20, 40, 80, 160, 320)]),
    "hnsw32": ("HNSW m=32, ef_construction=128", "USING hnsw (embedding vector_cosine_ops) WITH (m = 32, ef_construction = 128)",
               [("hnsw.ef_search", v) for v in (10, 20, 40, 80, 160, 320)]),
    "ivf_sqrt": (f"IVFFlat lists={sq} (sqrt N)", f"USING ivfflat (embedding vector_cosine_ops) WITH (lists = {sq})",
                 [("ivfflat.probes", v) for v in (1, 2, 5, 10, 20, 50, 100) if v <= sq]),
    "ivf_1000": (f"IVFFlat lists={max(N // 1000, 10)} (N/1000)", f"USING ivfflat (embedding vector_cosine_ops) WITH (lists = {max(N // 1000, 10)})",
                 [("ivfflat.probes", v) for v in (1, 2, 5, 10, 20, 50, 100) if v <= max(N // 1000, 10)]),
    "diskann": ("DiskANN (pgvectorscale), defaults", "USING diskann (embedding vector_cosine_ops)",
                [("diskann.query_search_list_size", (s, r)) for s, r in ((20, 50), (50, 50), (100, 50), (200, 50), (400, 50), (100, 200), (200, 200), (400, 400))]),
}

print(f"N={N}, dim={DIM}, queries={len(Q)}, k={K}", flush=True)
RC10 = float('nan')
truth, exact_lat = exact_truth()
SIGMA = dict(conn.execute('SELECT key, value FROM bench.meta').fetchall())
print(f"data difficulty: median RC10 {RC10:.1f} (real corpus {SIGMA.get('real_rc10')}), sigma {SIGMA.get('sigma')}", flush=True)
results = [{"index": "exact (sequential scan)", "params": "none", "recall": 1.0, "p50_ms": float(np.percentile(exact_lat, 50)), "p95_ms": float(np.percentile(exact_lat, 95)),
            "mean_ms": float(np.mean(exact_lat)), "qps": float(1000 / np.mean(exact_lat)), "rows_returned": float(K)}]
print(f"exact scan: p50 {results[0]['p50_ms']:.1f} ms", flush=True)
builds = {}
conn.execute("SET enable_seqscan = off")  # make sure the index is used: the point is index behaviour, not planner choice

for key in [k for k in a.indexes.split(",") if k]:
    label, ddl, grid = SPECS[key]
    drop_indexes()
    t0 = time.time()
    conn.execute(f"CREATE INDEX bench_idx {ddl.replace('USING', 'ON bench.event_vec USING', 1)}")
    build_s = time.time() - t0
    conn.execute("ANALYZE bench.event_vec")
    builds[label] = {"build_s": build_s, "size_mb": size_mb("bench_idx")}
    print(f"[{label}] built in {build_s:.1f}s, {builds[label]['size_mb']:.0f} MB", flush=True)
    for guc, val in grid:
        if key == "diskann":
            conn.execute(f"SET diskann.query_search_list_size = {val[0]}")
            conn.execute(f"SET diskann.query_rescore = {val[1]}")
            shown = f"search_list={val[0]}, rescore={val[1]}"
        else:
            conn.execute(f"SET {guc} = {val}")
            shown = f"{guc.split('.')[1]}={val}"
        pt = point(label, shown, *run_queries(a.passes))
        results.append(pt)
        print(f"   {shown:<34} recall@{K} {pt['recall']:.3f}  p50 {pt['p50_ms']:6.2f} ms  p95 {pt['p95_ms']:6.2f} ms  rows {pt['rows_returned']:.1f}", flush=True)
drop_indexes()

meta = {"taken_at": datetime.now(timezone.utc).isoformat(), "n_vectors": N, "dimensions": DIM, "queries": len(Q), "k": K, "passes": a.passes,
        "postgres": {k: conn.execute("SELECT current_setting(%s)", (k,)).fetchone()[0] for k in ("shared_buffers", "maintenance_work_mem", "effective_cache_size", "max_parallel_workers")},
        "versions": dict(conn.execute("SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','vectorscale','timescaledb')").fetchall()),
        "sigma": SIGMA.get("sigma"), "rc10_synthetic": RC10, "rc10_real": SIGMA.get("real_rc10"), "real_duplicate_fraction": SIGMA.get("real_dup_fraction"),
        "note": "vectors are real event embeddings scaled up by perturbation (see bench_vectors.py); seqscan disabled for index runs"}
os.makedirs(a.out_dir, exist_ok=True)
tag = f"ann_{N}{('_' + a.label) if a.label else ''}"
json.dump({"meta": meta, "builds": builds, "points": results}, open(f"{a.out_dir}/{tag}.json", "w"), indent=1)

md = [f"# Vector index benchmark, {N:,} vectors of {DIM} dimensions", "",
      f"{len(Q)} held-out queries, top-{K}, exact ground truth by sequential scan ({results[0]['p50_ms']:.0f} ms p50 per query). Single connection, warm cache, "
      f"{a.passes} measured passes. {meta['versions']}; shared_buffers {meta['postgres']['shared_buffers']}. Data: noise sigma {meta['sigma']}, "
      f"median relative contrast RC10 {RC10:.1f} (the real {len(Q) and meta['rc10_real']}; lower is harder).", "",
      "| index | build time | size |", "|---|---|---|"]
for lab, b in builds.items():
    md.append(f"| {lab} | {b['build_s']:.1f} s | {b['size_mb']:.0f} MB |")
md += ["", "Fastest setting (lowest p50) that reaches a recall target:", "", "| index | recall ≥ 0.90 | recall ≥ 0.95 | recall ≥ 0.99 |", "|---|---|---|---|"]
for lab in builds:
    cells = []
    for tgt in (0.90, 0.95, 0.99):
        ok = [r for r in results if r["index"] == lab and r["recall"] >= tgt]
        best = min(ok, key=lambda r: r["p50_ms"]) if ok else None
        cells.append(f"{best['p50_ms']:.2f} ms ({best['params']})" if best else "not reached")
    md.append(f"| {lab} | " + " | ".join(cells) + " |")
md += ["", "All settings:", "", "| index | setting | recall@%d | p50 ms | p95 ms | queries/s | rows returned |" % K, "|---|---|---|---|---|---|---|"]
for r in results:
    md.append(f"| {r['index']} | {r['params']} | {r['recall']:.3f} | {r['p50_ms']:.2f} | {r['p95_ms']:.2f} | {r['qps']:.0f} | {r['rows_returned']:.1f} |")
open(f"{a.out_dir}/{tag}.md", "w").write("\n".join(md) + "\n")
print(f"wrote {a.out_dir}/{tag}.md")
