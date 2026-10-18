"""Pick a reproducible, stratified subset of Flight Review logs into a manifest."""
import argparse
import gzip
import json
import random
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--index", default="/data/raw/dbinfo.json.gz")
p.add_argument("--out", default="/data/raw/manifest.jsonl")
p.add_argument("--n-labeled", type=int, default=150)
p.add_argument("--n-errors", type=int, default=75)
p.add_argument("--n-clean", type=int, default=75)
p.add_argument("--seed", type=int, default=42)
a = p.parse_args()

rows = json.load(gzip.open(a.index))
ok = [
    r for r in rows
    if r["type"] == "flightreport" and r["mav_type"] == "Quadrotor"
    and 120 <= (r["duration_s"] or 0) <= 900 and r["log_date"] >= "2024-01-01"
    and r["sys_hw"] != "PX4_SITL" and r["estimator"] == "EKF2"
]


def labeled(r):
    return bool(r["error_labels"]) or (r["feedback"] or "").strip() or r["rating"] not in ("", "none")


rng = random.Random(a.seed)
lab = [r for r in ok if labeled(r)]
err = [r for r in ok if not labeled(r) and r["num_logged_errors"] > 0]
clean = [r for r in ok if not labeled(r) and r["num_logged_errors"] == 0]
pick = [(s, k) for s, pool in (("labeled", lab), ("errors", err), ("clean", clean))
        for k in rng.sample(pool, min(len(pool), {"labeled": a.n_labeled, "errors": a.n_errors, "clean": a.n_clean}[s]))]

Path(a.out).parent.mkdir(parents=True, exist_ok=True)
with open(a.out, "w") as f:
    for stratum, r in pick:
        f.write(json.dumps({"stratum": stratum, **r}) + "\n")
print(f"candidates={len(ok)} labeled={len(lab)} errors={len(err)} clean={len(clean)} -> wrote {len(pick)} to {a.out}")
