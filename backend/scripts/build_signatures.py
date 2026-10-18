"""Per-flight behavioural signatures: similarity by how a flight behaved, not by what its text says.

Features per flight: mean, std, min and max of every canonical signal present in enough flights, event rates per minute for every event kind,
the share of time in each flight mode, and log duration. Robust-scaled (median and IQR, clipped), reduced to 32 dimensions with PCA, and
L2-normalised so cosine distance works. The fitted scaler is stored so new flights can be transformed without refitting.
Also evaluates itself: do a flight's nearest neighbours share its hardware more often than chance?

  python scripts/build_signatures.py
"""
import json
import os
from datetime import datetime, timezone

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

from app.config import settings
from app.events.ulog_events import NAV_STATE

DIMS = 32
MODES = ["Position", "Manual", "Altitude", "Hold", "Stabilized", "Land", "Mission", "Return"]
OUT = "/bench/results"

conn = psycopg.connect(settings.dsn, autocommit=True)
register_vector(conn)
conn.execute("SET statement_timeout = 0")
flights = [r[0] for r in conn.execute("SELECT id FROM flight ORDER BY id").fetchall()]
idx = {f: i for i, f in enumerate(flights)}
n = len(flights)
boards = [r[0] or "unknown" for r in conn.execute("SELECT metadata->>'sys_hw' FROM flight ORDER BY id").fetchall()]
print(f"{n} flights", flush=True)

# --- raw features ---------------------------------------------------------------------------------------------------------------
stats = conn.execute("""
    SELECT t.flight_id, c.key, avg(t.value * m.scale + m."offset"), stddev_samp(t.value * m.scale + m."offset"),
           min(t.value * m.scale + m."offset"), max(t.value * m.scale + m."offset")
    FROM telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
    JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal' GROUP BY t.flight_id, c.key""").fetchall()
count = {}
for _, key, *_ in stats:
    count[key] = count.get(key, 0) + 1
signals = sorted(k for k, v in count.items() if v >= 0.3 * n and not k.startswith("mode.") and k not in ("gps.lat", "gps.lon"))
names = [f"{s}.{st}" for s in signals for st in ("mean", "std", "min", "max")]
kinds = [r[0] for r in conn.execute("SELECT key FROM concept WHERE kind = 'event' ORDER BY key").fetchall()]
names += [f"events_per_min.{k}" for k in kinds] + [f"mode_share.{m}" for m in MODES + ["Other"]] + ["log_duration"]
X = np.full((n, len(names)), np.nan)
col = {s: 4 * i for i, s in enumerate(signals)}
for fid, key, mean, std, lo, hi in stats:
    if key in col:
        X[idx[fid], col[key]:col[key] + 4] = [mean, std if std is not None else 0.0, lo, hi]
dur = {r[0]: r[1] for r in conn.execute("SELECT id, duration_s FROM flight").fetchall()}
base = 4 * len(signals)
for fid, kind, c in conn.execute("SELECT flight_id, c.key, count(*) FROM event e JOIN concept c ON c.id = e.kind_id GROUP BY 1, 2").fetchall():
    X[idx[fid], base + kinds.index(kind)] = c / max(dur[fid] / 60, 0.5)
X[:, base:base + len(kinds)] = np.where(np.isnan(X[:, base:base + len(kinds)]), 0.0, X[:, base:base + len(kinds)])  # no events of a kind means a rate of 0
shares = {}
for fid, v, c in conn.execute("""SELECT t.flight_id, t.value::int, count(*) FROM telemetry t JOIN vendor_field vf ON vf.id = t.vendor_field_id
                                 AND vf.topic = 'vehicle_status' AND vf.field = 'nav_state' GROUP BY 1, 2""").fetchall():
    shares.setdefault(fid, {})[v] = c
for fid, d in shares.items():
    tot = sum(d.values())
    mode_cols = {m: 0.0 for m in MODES + ["Other"]}
    for v, c in d.items():
        mode_cols[NAV_STATE.get(v, "Other") if NAV_STATE.get(v) in MODES else "Other"] += c / tot
    X[idx[fid], base + len(kinds):base + len(kinds) + len(MODES) + 1] = [mode_cols[m] for m in MODES + ["Other"]]
X[:, -1] = np.log1p([dur[f] for f in flights])
print(f"{len(names)} features ({len(signals)} signals), {np.isnan(X).mean() * 100:.1f}% missing before filling", flush=True)

# --- robust scaling, PCA, normalisation -----------------------------------------------------------------------------------------
med = np.nanmedian(X, axis=0)
q75, q25 = np.nanpercentile(X, 75, axis=0), np.nanpercentile(X, 25, axis=0)
scale = np.where((q75 - q25) > 1e-9, q75 - q25, np.where(np.nanstd(X, axis=0) > 1e-9, np.nanstd(X, axis=0), 1.0))
Z = np.clip((X - med) / scale, -5, 5)
Z = np.where(np.isnan(Z), 0.0, Z)
pca_mean = Z.mean(axis=0)
_, _, vt = np.linalg.svd(Z - pca_mean, full_matrices=False)
k = min(DIMS, vt.shape[0])
comp = np.zeros((DIMS, len(names)))
comp[:k] = vt[:k]
S = (Z - pca_mean) @ comp.T
S /= np.maximum(np.linalg.norm(S, axis=1, keepdims=True), 1e-9)
var = np.var((Z - pca_mean) @ vt.T, axis=0)
print(f"PCA keeps {100 * var[:k].sum() / var.sum():.0f}% of the variance in {k} dimensions", flush=True)

scaler = {"names": names, "median": med.tolist(), "scale": scale.tolist(), "pca_mean": pca_mean.tolist(), "components": comp.tolist(), "dims": DIMS}
conn.execute("INSERT INTO signature_scaler (id, scaler, fitted_at) VALUES (1, %s, now()) ON CONFLICT (id) DO UPDATE SET scaler = EXCLUDED.scaler, fitted_at = now()", (json.dumps(scaler),))
with conn.cursor() as cur:
    cur.executemany("""INSERT INTO flight_signature (flight_id, features, signature, computed_at) VALUES (%s, %s, %s, now())
                       ON CONFLICT (flight_id) DO UPDATE SET features = EXCLUDED.features, signature = EXCLUDED.signature, computed_at = now()""",
                    [(f, [None if np.isnan(v) else float(v) for v in X[i]], S[i].astype(np.float32)) for i, f in enumerate(flights)])
conn.execute("CREATE INDEX IF NOT EXISTS flight_signature_hnsw ON flight_signature USING hnsw (signature vector_cosine_ops)")
print(f"stored {n} signatures", flush=True)

# --- evaluation: leave-one-out nearest neighbours; do they share the board? -------------------------------------------------------
def agreement(M: np.ndarray, k_nn: int = 5):
    M = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)
    sim = M @ M.T
    np.fill_diagonal(sim, -np.inf)
    nn = np.argsort(-sim, axis=1)[:, :k_nn]
    b = np.array(boards)
    return float(np.mean([(b[nn[i]] == b[i]).mean() for i in range(len(b))]))


counts = {}
for b in boards:
    counts[b] = counts.get(b, 0) + 1
chance = sum(c / n * (c - 1) / (n - 1) for c in counts.values())
multi = [i for i, b in enumerate(boards) if counts[b] > 1]  # flights whose board occurs at least twice, so a same-board neighbour exists
res = {"taken_at": datetime.now(timezone.utc).isoformat(), "flights": n, "features": len(names), "dimensions": k, "variance_kept": float(var[:k].sum() / var.sum()),
       "k": 5, "board_agreement_signature": agreement(S), "board_agreement_scaled_features": agreement(np.where(np.isnan(Z), 0, Z)),
       "board_agreement_chance": chance, "flights_with_a_same_board_peer": len(multi),
       "note": "Fraction of a flight's 5 nearest neighbours that share its board, leave-one-out. A sanity check, not a ground truth: hardware influences sensor scale, so some agreement is expected."}
os.makedirs(OUT, exist_ok=True)
json.dump(res, open(f"{OUT}/signature_eval.json", "w"), indent=1)
open(f"{OUT}/signature_eval.md", "w").write(
    f"# Flight signature sanity check\n\n{n} flights, {len(names)} features reduced to {k} dimensions ({100 * res['variance_kept']:.0f}% of variance). "
    f"Share of a flight's 5 nearest neighbours that run on the same board (leave-one-out):\n\n| representation | same-board neighbours |\n|---|---|\n"
    f"| chance (random neighbours) | {chance:.3f} |\n| scaled features, cosine | {res['board_agreement_scaled_features']:.3f} |\n| 32-dimension signature, cosine | {res['board_agreement_signature']:.3f} |\n\n{res['note']}\n")
print(f"same-board neighbours: chance {chance:.3f}, scaled features {res['board_agreement_scaled_features']:.3f}, signature {res['board_agreement_signature']:.3f}")
