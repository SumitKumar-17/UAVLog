"""Experiment 5: NL-to-SQL execution accuracy with the semantic layer vs raw tables.

  python scripts/eval_nlsql.py --check-gold     # the two gold queries per question must return the same results
  python scripts/eval_nlsql.py                  # run both conditions, write bench/results/nlsql_eval_<label>.{json,md}
"""
import argparse
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import psycopg
from psycopg_pool import ConnectionPool

from app.config import settings
from app.llm import LLMClient
from app.nlsql.generate import ask

p = argparse.ArgumentParser()
p.add_argument("--questions", default="/bench/eval/nlsql_questions.json")
p.add_argument("--out-dir", default="/bench/results")
p.add_argument("--label", default="gpt")
p.add_argument("--check-gold", action="store_true")
p.add_argument("--workers", type=int, default=4)
p.add_argument("--boot", type=int, default=5000)
a = p.parse_args()
Q = json.load(open(a.questions))["questions"]


def cell(v):
    if isinstance(v, (list, tuple)):
        return tuple(cell(x) for x in v)
    if v is None or isinstance(v, str):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v)


def close(x, y):
    if isinstance(x, float) and isinstance(y, float):
        return abs(x - y) <= max(0.051, 0.005 * abs(y))
    return x == y


def same_rows(pred, gold) -> bool:
    if len(pred) != len(gold):
        return False
    left = [list(map(cell, r)) for r in pred]
    for g in gold:
        g = list(map(cell, g))
        hit = next((i for i, r in enumerate(left) if len(r) == len(g) and all(close(x, y) for x, y in zip(r, g))), None)
        if hit is None:
            return False
        left.pop(hit)
    return True


def lenient(pred, gold) -> bool:
    """Gold columns all present in the prediction (any order, extra columns allowed)."""
    if not gold or not pred:
        return same_rows(pred, gold)
    ng, npred = len(gold[0]), len(pred[0])
    mapping = []
    for j in range(ng):
        gcol = sorted(cell(r[j]) for r in gold)
        k = next((k for k in range(npred) if len(pred) == len(gold) and all(close(x, y) for x, y in zip(sorted(cell(r[k]) for r in pred), gcol))), None)
        if k is None:
            return False
        mapping.append(k)
    return same_rows([[r[k] for k in mapping] for r in pred], gold)


def gold_rows(conn, sql):
    return conn.execute(sql).fetchall()


if a.check_gold:
    bad = 0
    with psycopg.connect(settings.dsn, autocommit=True) as conn:
        for q in (x for x in Q if x["answerable"]):
            s, r = gold_rows(conn, q["semantic_sql"]), gold_rows(conn, q["raw_sql"])
            ok = same_rows(s, r) and len(s) > 0
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {q['id']} {q['category']:<11} semantic={str(s[:2])[:60]:<62} raw={str(r[:2])[:60]}")
    print("\nall golds agree" if not bad else f"\n{bad} questions have disagreeing or empty golds")
    raise SystemExit(1 if bad else 0)


def classify(ans) -> str:
    if ans.cannot_answer:
        return "refused"
    if ans.error:
        e = ans.error
        if "too expensive" in e:
            return "cost_refused"
        if any(k in e for k in ("not available", "not allowed", "Only SELECT", "Send exactly", "not valid PostgreSQL", "Table-valued", "WITH is only", "Recursive")):
            return "guard_refused"
        return "db_error"
    return "answered"


pool = ConnectionPool(settings.dsn, min_size=2, max_size=a.workers * 2 + 2, open=True, kwargs={"autocommit": True})
llm = LLMClient(pool=pool)
with psycopg.connect(settings.dsn, autocommit=True) as conn:
    GOLD = {q["id"]: gold_rows(conn, q["semantic_sql"]) for q in Q if q["answerable"]}


def one(args):
    q, mode = args
    ans = ask(pool, llm, q["question"], mode, explain=False, max_repairs=2)
    status = classify(ans)
    rec = {"id": q["id"], "category": q["category"], "mode": mode, "answerable": q["answerable"], "status": status,
           "attempts": len(ans.attempts), "sql": ans.sql or (ans.attempts[-1].sql if ans.attempts else None), "error": ans.error,
           "generate_ms": ans.generate_ms, "cost": ans.cost}
    if q["answerable"]:
        rec["strict"] = status == "answered" and same_rows(ans.rows, GOLD[q["id"]])
        rec["lenient"] = status == "answered" and lenient(ans.rows, GOLD[q["id"]])
        rec["first_try"] = rec["strict"] and len(ans.attempts) == 1
        rec["truncated"] = ans.truncated
    else:
        rec["strict"] = rec["lenient"] = rec["first_try"] = status != "answered"  # success = refusing
    return rec


jobs = [(q, m) for q in Q for m in ("semantic", "raw")]
with ThreadPoolExecutor(a.workers) as ex:
    res = list(ex.map(one, jobs))
pool.close()

rng = np.random.default_rng(0)


def ci(x):
    x = np.array(x, float)
    b = rng.choice(x, (a.boot, len(x))).mean(axis=1)
    return x.mean(), np.percentile(b, 2.5), np.percentile(b, 97.5)


def pick(mode, cat=None, answerable=True):
    return [r for r in res if r["mode"] == mode and r["answerable"] == answerable and (cat is None or r["category"] == cat)]


md = [f"# NL-to-SQL evaluation ({datetime.now(timezone.utc).date()})", "",
      f"Model `{settings.llm_model}`, temperature 0, up to 2 self-repair rounds. {len(Q)} questions "
      f"({sum(x['answerable'] for x in Q)} answerable, {sum(not x['answerable'] for x in Q)} unanswerable). "
      "Execution accuracy: the result set equals the gold query's (order-insensitive, numbers within rounding). "
      "Mean over questions with 95% bootstrap CI.", "",
      "| condition | strict EX | lenient EX | first-try EX | mean attempts | mean generate ms |", "|---|---|---|---|---|---|"]
summary = {}
for mode in ("semantic", "raw"):
    rs = pick(mode)
    cells = []
    for k in ("strict", "lenient", "first_try"):
        m, lo, hi = ci([r[k] for r in rs])
        cells.append(f"{m:.2f} [{lo:.2f}, {hi:.2f}]")
        summary.setdefault(mode, {})[k] = {"mean": m, "lo": lo, "hi": hi, "n": len(rs)}
    md.append(f"| {mode} | " + " | ".join(cells) + f" | {np.mean([r['attempts'] for r in rs]):.2f} | {np.mean([r['generate_ms'] for r in rs]):.0f} |")

sem = {r["id"]: r for r in pick("semantic")}
raw = {r["id"]: r for r in pick("raw")}
b = sum(sem[i]["strict"] and not raw[i]["strict"] for i in sem)
c = sum(raw[i]["strict"] and not sem[i]["strict"] for i in sem)
n = b + c
pval = min(1.0, 2 * sum(math.comb(n, k) for k in range(0, min(b, c) + 1)) / 2 ** n) if n else 1.0
md += ["", f"Paired comparison (strict EX): semantic correct and raw wrong on {b} questions, raw correct and semantic wrong on {c}; "
       f"exact two-sided sign test p = {pval:.4f}.", "", "## By category (strict EX, semantic | raw)", "", "| category | questions | semantic | raw |", "|---|---|---|---|"]
for cat in dict.fromkeys(q["category"] for q in Q if q["answerable"]):
    s_, r_ = pick("semantic", cat), pick("raw", cat)
    md.append(f"| {cat} | {len(s_)} | {sum(x['strict'] for x in s_)}/{len(s_)} | {sum(x['strict'] for x in r_)}/{len(r_)} |")

md += ["", "## What happened to each answerable question", "", "| outcome | semantic | raw |", "|---|---|---|"]
for st in ("answered", "refused", "cost_refused", "guard_refused", "db_error"):
    cnt = {m: sum(r["status"] == st for r in pick(m)) for m in ("semantic", "raw")}
    label = {"answered": "returned rows", "refused": "said it cannot answer", "cost_refused": "stopped by the cost check", "guard_refused": "stopped by the guard", "db_error": "database error"}[st]
    md.append(f"| {label} | {cnt['semantic']} | {cnt['raw']} |")
wrong = {m: sum(r["status"] == "answered" and not r["strict"] for r in pick(m)) for m in ("semantic", "raw")}
md.append(f"| returned rows, but the wrong ones | {wrong['semantic']} | {wrong['raw']} |")

md += ["", "## Unanswerable questions (success = refusing)", "", "| condition | refused | fabricated an answer |", "|---|---|---|"]
for mode in ("semantic", "raw"):
    u = pick(mode, answerable=False)
    md.append(f"| {mode} | {sum(r['strict'] for r in u)} | {sum(not r['strict'] for r in u)} |")

md += ["", "## Questions answered wrongly or not at all", ""]
for mode in ("semantic", "raw"):
    md.append(f"### {mode}")
    for r in pick(mode):
        if not r["strict"]:
            q = next(x for x in Q if x["id"] == r["id"])
            md.append(f"- **{r['id']}** {q['question']} ({r['status']}{', ' + str(r['error'])[:90] if r['error'] else ''})" + (f"\n  `{' '.join(str(r['sql']).split())[:230]}`" if r["sql"] else ""))
    md.append("")

os.makedirs(a.out_dir, exist_ok=True)
json.dump({"model": settings.llm_model, "taken_at": datetime.now(timezone.utc).isoformat(), "summary": summary, "sign_test": {"b": b, "c": c, "p": pval}, "results": res},
          open(f"{a.out_dir}/nlsql_eval_{a.label}.json", "w"), indent=1, default=str)
open(f"{a.out_dir}/nlsql_eval_{a.label}.md", "w").write("\n".join(md) + "\n")
print("\n".join(md[:30]))
