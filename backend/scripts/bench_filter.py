"""Experiment 3: filtered vector search. pgvector applies a WHERE filter AFTER the approximate scan, so a selective filter can leave
fewer than k rows. This compares strategies as the filter gets more selective.

Two filters: `bucket < t` (uniform, independent of the vector: exactly controlled selectivity) and `kind_id = <the query's own kind>`
(correlated with the query, real skewed selectivities). Ground truth: exact filtered search with no ANN index.

  python scripts/bench_filter.py            (needs schema `bench` from bench_vectors.py)
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.config import settings

p = argparse.ArgumentParser()
p.add_argument("--k", type=int, default=10)
p.add_argument("--passes", type=int, default=2)
p.add_argument("--out-dir", default="/bench/results")
p.add_argument("--label", default="")
p.add_argument("--only-diskann", action="store_true", help="run just the DiskANN label-filter strategy and merge it into the existing result file")
a = p.parse_args()
K = a.k

conn = psycopg.connect(settings.dsn, autocommit=True)
register_vector(conn)
N = conn.execute("SELECT count(*) FROM bench.event_vec").fetchone()[0]
Q = [(r[0], r[1], r[2].to_numpy() if hasattr(r[2], "to_numpy") else np.asarray(r[2]))
     for r in conn.execute("SELECT qid, kind_id, embedding FROM bench.query_vec ORDER BY qid")]
conn.execute("SET maintenance_work_mem = '1500MB'; SET max_parallel_maintenance_workers = 3; SET statement_timeout = '120s'")
KIND_FREQ = dict(conn.execute("SELECT kind_id, count(*)::float / %s FROM bench.event_vec GROUP BY 1", (N,)).fetchall())


def drop_indexes(table="event_vec"):
    for (name,) in conn.execute("SELECT indexname FROM pg_indexes WHERE schemaname = 'bench' AND tablename = %s AND indexname !~ '_pkey$'", (table,)).fetchall():
        conn.execute(f"DROP INDEX bench.{name}")


def timed(sql):
    """Wall time of a statement; index builds can run for minutes, so the 120 s query timeout is lifted around them."""
    conn.execute("SET statement_timeout = 0")
    t0 = time.time()
    try:
        conn.execute(sql)
    finally:
        conn.execute("SET statement_timeout = '120s'")
    return time.time() - t0


def run(table, where_sql, arg_for, passes):
    """Run every query `passes` times after one warm-up pass. Returns ids from the last pass and all measured latencies in
    pass-major order (so lats[i] belongs to query i % len(Q))."""
    out, lats = {}, []
    sql = f"SELECT id FROM bench.{table} WHERE {where_sql} ORDER BY embedding <=> %(v)s LIMIT {K}"
    for ps in range(passes + 1):
        for qid, kind, v in Q:
            t0 = time.perf_counter()
            ids = [r[0] for r in conn.execute(sql, {**arg_for(kind), "v": v}).fetchall()]
            ms = (time.perf_counter() - t0) * 1000
            if ps:
                lats.append(ms)
            out[qid] = ids
    return out, lats


def score(res, lats, truth, label, family, spec, extra=None):
    rec = [len(set(res[q]) & set(truth[q])) / max(len(truth[q]), 1) for q in res if truth[q]]
    rows = [len(res[q]) for q in res]
    return {"strategy": label, "family": family, "filter": spec, "recall": float(np.mean(rec)) if rec else None, "rows_returned": float(np.mean(rows)),
            "short_queries": int(sum(1 for q in res if len(res[q]) < min(K, len(truth[q])))), "p50_ms": float(np.percentile(lats, 50)), "p95_ms": float(np.percentile(lats, 95)), **(extra or {})}


FILTERS = {  # family -> list of (spec label, where sql, arg builder, selectivity fn(kind))
    "uncorrelated": [(f"{s * 100:g}%", "bucket < %(t)s", (lambda kind, t=int(s * 10000): {"t": t}), (lambda kind, s=s: s)) for s in (0.0001, 0.001, 0.01, 0.1, 0.5)],
}


def truth_for(table, where_sql, arg_for):
    drop_indexes(table)
    conn.execute("SET enable_indexscan = off; SET enable_bitmapscan = off")
    t, _ = run(table, where_sql, arg_for, 0)
    conn.execute("RESET enable_indexscan; RESET enable_bitmapscan")
    return t


points, builds = [], {}
print(f"N={N}, queries={len(Q)}, k={K}", flush=True)

# ---- ground truth, computed with no ANN index (a B-tree on the filter columns would only make exact search faster, not different)
truth_u = {} if a.only_diskann else {spec: truth_for("event_vec", where, arg) for spec, where, arg, _ in FILTERS["uncorrelated"]}
kind_where, kind_arg = "kind_id = %(kind)s", (lambda kind: {"kind": kind})
truth_k = truth_for("event_vec", kind_where, kind_arg)
print("ground truth done", flush=True)


def tier(kind):
    f = KIND_FREQ[kind]
    return "common (>10%)" if f > 0.10 else "medium (1-10%)" if f > 0.01 else "rare (<1%)"


def eval_uncorrelated(label, setup_sql=()):
    for s in setup_sql:
        conn.execute(s)
    for spec, where, arg, _ in FILTERS["uncorrelated"]:
        res, lats = run("event_vec", where, arg, a.passes)
        pt = score(res, lats, truth_u[spec], label, "uncorrelated", spec)
        points.append(pt)
        print(f"  {label:<34} filter {spec:>6}  recall {pt['recall']:.3f}  rows {pt['rows_returned']:5.2f}  p50 {pt['p50_ms']:8.2f} ms", flush=True)


def eval_kind(label, table="event_vec", where=kind_where, arg=kind_arg, setup_sql=()):
    for s in setup_sql:
        conn.execute(s)
    res, lats = run(table, where, arg, a.passes)
    for t_name in ("common (>10%)", "medium (1-10%)", "rare (<1%)"):
        qids = [q for q, kind, _ in Q if tier(kind) == t_name]
        if not qids:
            continue
        sub = {q: res[q] for q in qids}
        tier_lats = [l for i, l in enumerate(lats) if tier(Q[i % len(Q)][1]) == t_name]
        pt = score(sub, tier_lats, truth_k, label, "kind", t_name)
        points.append(pt)
        print(f"  {label:<34} kind {t_name:<15} recall {pt['recall']:.3f}  rows {pt['rows_returned']:5.2f}  p50 {pt['p50_ms']:8.2f} ms", flush=True)


HNSW = "CREATE INDEX bench_hnsw ON bench.event_vec USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"

def diskann_section():
    try:  # DiskANN label filtering (pgvectorscale)
        conn.execute("ALTER TABLE bench.event_vec ADD COLUMN IF NOT EXISTS labels smallint[]")
        conn.execute("UPDATE bench.event_vec SET labels = ARRAY[kind_id::smallint] WHERE labels IS NULL")
        builds["diskann with labels"] = {"build_s": timed("CREATE INDEX bench_diskann ON bench.event_vec USING diskann (embedding vector_cosine_ops, labels)")}
        conn.execute("ANALYZE bench.event_vec")
        conn.execute("SET enable_seqscan = off; SET diskann.query_search_list_size = 100; SET diskann.query_rescore = 200")
        print("[diskann label filter]", flush=True)
        eval_kind("diskann labels, list=100, rescore=200", where="labels && ARRAY[%(kind)s]::smallint[]")
        conn.execute("RESET enable_seqscan")
    except Exception as e:  # noqa: BLE001 - optional comparator; record why it did not run
        builds["diskann with labels"] = {"error": f"{type(e).__name__}: {str(e).splitlines()[0]}"}
        print("diskann labels skipped:", builds["diskann with labels"]["error"], flush=True)
    drop_indexes()



def write_outputs(points, builds):
    meta = {"taken_at": datetime.now(timezone.utc).isoformat(), "n_vectors": N, "queries": len(Q), "k": K, "passes": a.passes,
            "versions": dict(conn.execute("SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','vectorscale')").fetchall()),
            "sigma": dict(conn.execute("SELECT key, value FROM bench.meta").fetchall()).get("sigma"),
            "kind_selectivity": {str(k): round(v, 5) for k, v in sorted(KIND_FREQ.items(), key=lambda x: -x[1])}}
    os.makedirs(a.out_dir, exist_ok=True)
    tag = f"filter_{N}{('_' + a.label) if a.label else ''}"
    json.dump({"meta": meta, "builds": builds, "points": points}, open(f"{a.out_dir}/{tag}.json", "w"), indent=1)

    md = [f"# Filtered vector search, {N:,} vectors", "", f"{len(Q)} queries, top-{K}, ground truth by exact filtered search. 'rows' is the mean number of rows returned (target {K}); "
          "'short' counts queries that returned fewer rows than exist.", ""]
    for fam, title in (("uncorrelated", "Independent filter (`bucket < t`, exact selectivities)"), ("kind", "Filter correlated with the query (`kind_id` = the query's own kind)")):
        specs = list(dict.fromkeys(pt["filter"] for pt in points if pt["family"] == fam))
        md += [f"## {title}", "", "| strategy | " + " | ".join(specs) + " |", "|---|" + "---|" * len(specs)]
        for strat in dict.fromkeys(pt["strategy"] for pt in points if pt["family"] == fam):
            cells = []
            for sp in specs:
                pt = next((x for x in points if x["family"] == fam and x["strategy"] == strat and x["filter"] == sp), None)
                cells.append(f"R {pt['recall']:.2f} · {pt['rows_returned']:.1f} rows · {pt['p50_ms']:.1f} ms" if pt and pt["recall"] is not None else "–")
            md.append(f"| {strat} | " + " | ".join(cells) + " |")
        md.append("")
    md += ["## Build cost", "", "| strategy | build time | size |", "|---|---|---|"]
    for lab, b in builds.items():
        md.append(f"| {lab} | {b['build_s']:.1f} s | {('%.0f MB' % b['size_mb']) if b.get('size_mb') else 'n/a'} |" if "error" not in b else f"| {lab} | not run: {b['error']} | |")
    open(f"{a.out_dir}/{tag}.md", "w").write("\n".join(md) + "\n")
    print(f"wrote {a.out_dir}/{tag}.md")



if a.only_diskann:  # rerun just this strategy and merge it into the existing result file
    old = json.load(open(f"{a.out_dir}/filter_{N}{('_' + a.label) if a.label else ''}.json"))
    points[:] = [x for x in old["points"] if not x["strategy"].startswith("diskann")]
    builds.clear()
    builds.update(old["builds"])
    diskann_section()
    write_outputs(points, builds)
    raise SystemExit

# ---- strategies on one global HNSW index (only the vector index exists, so the planner must use it)
drop_indexes()
builds["hnsw"] = {"build_s": timed(HNSW)}
builds["hnsw"]["size_mb"] = conn.execute("SELECT pg_relation_size('bench.bench_hnsw')").fetchone()[0] / 1e6
conn.execute("ANALYZE bench.event_vec")
conn.execute("SET enable_seqscan = off")
for label, sets in {
    "hnsw post-filter, ef_search=40": ["SET hnsw.iterative_scan = off", "SET hnsw.ef_search = 40"],
    "hnsw post-filter, ef_search=400": ["SET hnsw.iterative_scan = off", "SET hnsw.ef_search = 400"],
    "hnsw iterative relaxed, ef=40": ["SET hnsw.iterative_scan = relaxed_order", "SET hnsw.ef_search = 40", "SET hnsw.max_scan_tuples = 20000"],
    "hnsw iterative strict, ef=40": ["SET hnsw.iterative_scan = strict_order", "SET hnsw.ef_search = 40", "SET hnsw.max_scan_tuples = 20000"],
    "hnsw iterative relaxed, scan limit N": ["SET hnsw.iterative_scan = relaxed_order", "SET hnsw.ef_search = 40", f"SET hnsw.max_scan_tuples = {N}"],
}.items():
    print(f"[{label}]", flush=True)
    eval_uncorrelated(label, sets)
    eval_kind(label)

# ---- B-tree filter then exact sort (no ANN index at all)
drop_indexes()
conn.execute("RESET enable_seqscan; RESET hnsw.iterative_scan")
conn.execute("CREATE INDEX bench_bucket ON bench.event_vec (bucket)")
conn.execute("CREATE INDEX bench_kind ON bench.event_vec (kind_id)")
conn.execute("ANALYZE bench.event_vec")
print("[b-tree filter + exact sort]", flush=True)
eval_uncorrelated("b-tree filter + exact sort")
eval_kind("b-tree filter + exact sort")

# ---- planner's own choice when both a vector index and B-trees exist
builds["hnsw+btrees"] = {"build_s": timed(HNSW)}
conn.execute("ANALYZE bench.event_vec")
conn.execute("SET hnsw.iterative_scan = off; SET hnsw.ef_search = 40")
print("[planner's choice: hnsw + b-trees]", flush=True)
eval_uncorrelated("planner's choice (hnsw + b-trees)")
eval_kind("planner's choice (hnsw + b-trees)")
drop_indexes()

# ---- strategies for the correlated (kind) filter: partial indexes, partitioning, label filtering
kinds = [k for (k,) in conn.execute("SELECT DISTINCT kind_id FROM bench.event_vec ORDER BY 1").fetchall()]
t0 = time.time()
for k in kinds:
    conn.execute(f"CREATE INDEX bench_part_{k} ON bench.event_vec USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE kind_id = {k}")
builds["partial hnsw per kind"] = {"build_s": time.time() - t0, "size_mb": sum(conn.execute("SELECT pg_relation_size(%s::regclass)", (f"bench.bench_part_{k}",)).fetchone()[0] for k in kinds) / 1e6, "indexes": len(kinds)}
conn.execute("ANALYZE bench.event_vec")
conn.execute("SET enable_seqscan = off; SET hnsw.iterative_scan = off; SET hnsw.ef_search = 40")
print("[partial hnsw per kind]", flush=True)
eval_kind("partial hnsw per kind, ef=40")
conn.execute("RESET enable_seqscan")
drop_indexes()

conn.execute("DROP TABLE IF EXISTS bench.event_vec_part")
conn.execute("CREATE TABLE bench.event_vec_part (LIKE bench.event_vec INCLUDING DEFAULTS) PARTITION BY LIST (kind_id)")
for k in kinds:
    conn.execute(f"CREATE TABLE bench.event_vec_part_{k} PARTITION OF bench.event_vec_part FOR VALUES IN ({k})")
conn.execute("INSERT INTO bench.event_vec_part SELECT * FROM bench.event_vec")
builds["list partitions + hnsw"] = {"build_s": timed("CREATE INDEX bench_part_idx ON bench.event_vec_part USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"), "partitions": len(kinds)}
conn.execute("ANALYZE bench.event_vec_part")
conn.execute("SET enable_seqscan = off; SET hnsw.iterative_scan = off; SET hnsw.ef_search = 40")
print("[list-partitioned by kind, hnsw per partition]", flush=True)
eval_kind("list partitions + hnsw, ef=40", table="event_vec_part")
conn.execute("RESET enable_seqscan")
conn.execute("DROP TABLE bench.event_vec_part")



diskann_section()

write_outputs(points, builds)
