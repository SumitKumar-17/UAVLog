"""Pick a stratified subset of Flight Review logs into a manifest. Expansion-safe: existing manifest
entries are always kept and only missing ones are appended, so growing a tier never discards finished work."""
import argparse
import gzip
import json
import random
from pathlib import Path

TIERS = {  # labeled / errors / clean
    "dev": (150, 75, 75),                  # 300 logs
    "k10": (10**9, 3000, 5532),            # ~10k logs (all labeled available)
    "eligible": (10**9, 10**9, 10**9),     # every eligible log (~76k)
}

p = argparse.ArgumentParser()
p.add_argument("--index", default="/data/raw/dbinfo.json.gz")
p.add_argument("--out", default="/data/raw/manifest.jsonl")
p.add_argument("--tier", choices=TIERS, default="dev")
p.add_argument("--n-labeled", type=int)
p.add_argument("--n-errors", type=int)
p.add_argument("--n-clean", type=int)
p.add_argument("--seed", type=int, default=42)
a = p.parse_args()
want = {s: (n if n is not None else d) for s, n, d in
        zip(("labeled", "errors", "clean"), (a.n_labeled, a.n_errors, a.n_clean), TIERS[a.tier])}

rows = json.load(gzip.open(a.index))
ok = [
    r for r in rows
    if r["type"] == "flightreport" and r["mav_type"] == "Quadrotor"
    and 120 <= (r["duration_s"] or 0) <= 900 and r["log_date"] >= "2024-01-01"
    and r["sys_hw"] != "PX4_SITL" and r["estimator"] == "EKF2"
]


def labeled(r):
    return bool(r["error_labels"]) or (r["feedback"] or "").strip() or r["rating"] not in ("", "none")


pools = {
    "labeled": [r for r in ok if labeled(r)],
    "errors": [r for r in ok if not labeled(r) and r["num_logged_errors"] > 0],
    "clean": [r for r in ok if not labeled(r) and r["num_logged_errors"] == 0],
}
out = Path(a.out)
existing = [json.loads(line) for line in open(out)] if out.exists() else []
have = {r["log_id"] for r in existing}
rng = random.Random(a.seed)
added = []
for stratum, pool in pools.items():
    pool.sort(key=lambda r: r["log_id"])  # deterministic base order, then seeded shuffle
    rng.shuffle(pool)
    need = max(0, want[stratum] - sum(1 for r in existing if r["stratum"] == stratum))
    added += [{"stratum": stratum, **r} for r in pool if r["log_id"] not in have][:need]

out.parent.mkdir(parents=True, exist_ok=True)
with open(out, "a") as f:
    for r in added:
        f.write(json.dumps(r) + "\n")
print(f"tier={a.tier} eligible={len(ok)} kept={len(existing)} added={len(added)} total={len(existing) + len(added)}")
