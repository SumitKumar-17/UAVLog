"""Evaluate event retrieval: vector vs full-text vs hybrid (RRF) on a concept-query benchmark, plus a small
human-label case study. Writes JSON + markdown to /bench/results. See docs/decisions.md for what it does and does not show."""
import argparse
import json
import math
import re
from datetime import datetime, timezone

import numpy as np
import psycopg

from app.config import settings
from app.llm import LLMClient
from app.search import MODES, search

p = argparse.ArgumentParser()
p.add_argument("--concepts", default="/bench/eval/concepts.json")
p.add_argument("--out-dir", default="/bench/results")
p.add_argument("--label", default="concept")
p.add_argument("--min-relevant", type=int, default=5)
p.add_argument("--boot", type=int, default=2000)
a = p.parse_args()
K, DEEP = 10, 50
rng = np.random.default_rng(0)

HUMAN = [  # (name, flight selector SQL, query)
    ("error label Vibration", "metadata->'error_labels' @> '[2]'::jsonb", "excessive vibration"),
    ("error label Component-failure", "metadata->'error_labels' @> '[5]'::jsonb", "motor or component failure"),
    ("error label Sensor-error", "metadata->'error_labels' @> '[4]'::jsonb", "sensor fault, unhealthy sensor"),
    ("feedback mentions crash", "metadata->>'feedback' ~* 'crash'", "vehicle crashed and lost control"),
]


def ci(x: np.ndarray) -> tuple[float, float, float]:
    boots = rng.choice(x, (a.boot, len(x))).mean(axis=1)
    return float(x.mean()), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


def metrics(ranked: list[dict], rel: set[int]) -> dict:
    hits = [r["id"] in rel for r in ranked]
    top = hits[:K]
    dcg = sum(h / math.log2(i + 2) for i, h in enumerate(top))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(rel), K)))
    first = next((i + 1 for i, h in enumerate(hits) if h), None)
    return {"p5": sum(hits[:5]) / 5, "p10": sum(top) / K, "ndcg10": dcg / ideal if ideal else 0.0,
            "mrr": 1 / first if first else 0.0, "miss": float(not any(top)),
            "flights10": len({r["flight"] for r in ranked[:K]}) / K}


with psycopg.connect(settings.dsn, autocommit=True) as conn:
    spec = json.load(open(a.concepts))["concepts"]
    n_events = conn.execute("SELECT count(*) FROM event WHERE embedding IS NOT NULL").fetchone()[0]
    rel, skipped = {}, []
    for name, c in spec.items():
        ids = {r[0] for r in conn.execute(
            "SELECT e.id FROM event e JOIN concept k ON k.id = e.kind_id WHERE k.key = ANY(%s) OR "
            "(%s::text IS NOT NULL AND k.key IN ('log_error','log_warning') AND e.description ~* %s)",
            (c["kinds"], c["regex"], c["regex"]))}
        (rel.__setitem__(name, ids) if len(ids) >= a.min_relevant else skipped.append((name, len(ids))))
    queries = [(n, t, h) for n, c in spec.items() if n in rel for t, h in c["queries"]]
    llm = LLMClient(conn)
    vecs = llm.embed([t for _, t, _ in queries])

    rows = {m: [] for m in MODES}
    for (n, t, h), v in zip(queries, vecs):
        for m in MODES:
            res = search(conn, llm, t, k=DEEP, pool=200, mode=m, vec=v)
            rows[m].append({"concept": n, "query": t, "hard": h, **metrics(res, rel[n])})

    report = {"taken_at": datetime.now(timezone.utc).isoformat(), "events": n_events, "embed_model": settings.embed_model,
              "queries": len(queries), "hard_queries": sum(h for _, _, h in queries), "skipped_concepts": skipped,
              "relevant_sizes": {k: len(v) for k, v in rel.items()}, "modes": {}, "per_query": rows}
    md = [f"# Retrieval evaluation ({report['taken_at'][:10]})", "",
          f"{n_events} events, {len(queries)} queries ({report['hard_queries']} hard) over {len(rel)} concepts; "
          f"skipped (fewer than {a.min_relevant} relevant events): {skipped or 'none'}. Embedding model {settings.embed_model}. "
          "Mean over queries with 95% bootstrap CI.", ""]
    for slice_name, pick in (("all", lambda r: True), ("easy", lambda r: not r["hard"]), ("hard", lambda r: r["hard"])):
        md += [f"## {slice_name} queries", "", "| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |", "|---|---|---|---|---|---|---|"]
        for m in MODES:
            sel = [r for r in rows[m] if pick(r)]
            cells = []
            for key in ("p5", "p10", "ndcg10", "mrr", "miss", "flights10"):
                mean, lo, hi = ci(np.array([r[key] for r in sel]))
                cells.append(f"{mean:.2f} [{lo:.2f}, {hi:.2f}]")
                report["modes"].setdefault(m, {}).setdefault(slice_name, {})[key] = {"mean": mean, "lo": lo, "hi": hi, "n": len(sel)}
            md.append(f"| {m} | " + " | ".join(cells) + " |")
        md.append("")
    # paired comparisons on nDCG@10
    for a_, b_ in (("rrf", "vector"), ("hybrid", "vector"), ("hybrid", "rrf"), ("hybrid", "fts")):
        d = np.array([x["ndcg10"] - y["ndcg10"] for x, y in zip(rows[a_], rows[b_])])
        mean, lo, hi = ci(d)
        md.append(f"Paired nDCG@10 difference, {a_} minus {b_}: {mean:+.3f} [{lo:+.3f}, {hi:+.3f}] over {len(d)} queries")
        report[f"paired_ndcg10_{a_}_minus_{b_}"] = {"mean": mean, "lo": lo, "hi": hi}
    # per-concept view (hybrid)
    md += ["", "## Per concept (mean nDCG@10)", "", "| concept | relevant events | rrf | hybrid | vector | fts |", "|---|---|---|---|---|---|"]
    for c in rel:
        vals = [np.mean([r["ndcg10"] for r in rows[m] if r["concept"] == c]) for m in ("rrf", "hybrid", "vector", "fts")]
        md.append(f"| {c} | {len(rel[c])} | " + " | ".join(f"{v:.2f}" for v in vals) + " |")

    # fusion-weight sensitivity: full-text weight w (vector weight fixed at 1); w=0 is vector-only, w=1 is plain RRF
    WS = [0.0, 0.1, 0.25, 0.5, 1.0]
    by_w = {0.0: rows["vector"], 1.0: rows["rrf"]}
    for w in WS[1:-1]:
        by_w[w] = [{"concept": n, "query": t, "hard": h, **metrics(search(conn, llm, t, k=DEEP, pool=200, vec=v, weights=(1.0, w)), rel[n])}
                   for (n, t, h), v in zip(queries, vecs)]
    md += ["", "## Fusion weight sensitivity (nDCG@10, mean [95% CI])", "", "| full-text weight | all | easy | hard |", "|---|---|---|---|"]
    for w in WS:
        cells = []
        for pick in (lambda r: True, lambda r: not r["hard"], lambda r: r["hard"]):
            mean, lo, hi = ci(np.array([r["ndcg10"] for r in by_w[w] if pick(r)]))
            cells.append(f"{mean:.3f} [{lo:.3f}, {hi:.3f}]")
        md.append(f"| {w:g} | " + " | ".join(cells) + " |")
    # leave-one-concept-out: pick w on the other concepts, score on the held-out one (avoids tuning on the test queries)
    concepts_ = list(rel)
    loco, chosen = [], {}
    for held in concepts_:
        best_w = max(WS, key=lambda w: np.mean([r["ndcg10"] for r in by_w[w] if r["concept"] != held]))
        chosen[held] = best_w
        loco += [r["ndcg10"] for r in by_w[best_w] if r["concept"] == held]
    mean, lo, hi = ci(np.array(loco))
    md += ["", f"Leave-one-concept-out selected weight: mean nDCG@10 {mean:.3f} [{lo:.3f}, {hi:.3f}] "
           f"(vector-only {np.mean([r['ndcg10'] for r in by_w[0.0]]):.3f}, plain RRF {np.mean([r['ndcg10'] for r in by_w[1.0]]):.3f}); "
           f"weights chosen per held-out concept: {sorted(set(chosen.values()))}"]
    report["fusion_weights"] = {str(w): float(np.mean([r["ndcg10"] for r in by_w[w]])) for w in WS}
    report["loco"] = {"mean": mean, "lo": lo, "hi": hi, "chosen": chosen}

    # human-label case study: rank flights by their best event score for a query
    md += ["", "## Human-label case study (flight level, default hybrid)", "",
           "Flights a person labelled, ranked by their best-matching event; random chance for top-10 is 10 of N flights. "
           "Small n: a case study, not a statistic.", "", "| label | labelled flights | in top 10 | in top 20 | median rank | never retrieved |", "|---|---|---|---|---|---|"]
    n_flights = conn.execute("SELECT count(*) FROM flight").fetchone()[0]
    report["human"] = []
    for name, sel, q in HUMAN:
        ids = [str(r[0]) for r in conn.execute(f"SELECT source_ref FROM flight WHERE {sel}")]
        res = search(conn, llm, q, k=1000, pool=1000, mode="hybrid")
        best: dict[str, float] = {}
        for r in res:
            best[r["flight"]] = max(best.get(r["flight"], 0), r["score"])
        order = {f: i + 1 for i, f in enumerate(sorted(best, key=best.get, reverse=True))}
        ranks = [order[i] for i in ids if i in order]
        row = {"label": name, "query": q, "labelled": len(ids), "top10": sum(r <= 10 for r in ranks), "top20": sum(r <= 20 for r in ranks),
               "median_rank": float(np.median(ranks)) if ranks else None, "never": len(ids) - len(ranks), "flights_ranked": len(order)}
        report["human"].append(row)
        md.append(f"| {name} (\"{q}\") | {len(ids)} | {row['top10']} | {row['top20']} | "
                  f"{row['median_rank'] if ranks else '-'} | {row['never']} |")
    md += ["", f"{n_flights} flights in total."]

import os
os.makedirs(a.out_dir, exist_ok=True)
json.dump(report, open(f"{a.out_dir}/eval_search_{a.label}.json", "w"), indent=2, default=str)
open(f"{a.out_dir}/eval_search_{a.label}.md", "w").write("\n".join(md) + "\n")
print("\n".join(md))
