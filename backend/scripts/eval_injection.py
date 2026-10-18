"""Fault-injection evaluation of the rule-based event detectors.

Real flights, faults injected into their telemetry at KNOWN times: a fault is a constant value held for `d` seconds, starting somewhere in
the middle of the flight. The unchanged rule engine then runs on each injected copy. Measures, per fault type and duration: how often
the right event kind overlaps the injected window, the onset error, and the false-alarm rate on unmodified control copies.
It tests the detectors (thresholds, minimum durations, sampling effects), not whether those thresholds are right for real faults.

  python scripts/eval_injection.py --flights 30
"""
import argparse
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg

from app.config import settings
from app.events.rules import RULES, rule_events

p = argparse.ArgumentParser()
p.add_argument("--flights", type=int, default=30)
p.add_argument("--seed", type=int, default=11)
p.add_argument("--out-dir", default="/bench/results")
a = p.parse_args()
rng = np.random.default_rng(a.seed)

# (label, canonical signal, injected value, expected event kind)
FAULTS = [
    ("battery critically low", "battery.remaining", 8.0, "battery_low"),
    ("GPS lost 3D fix", "gps.fix_type", 1.0, "gps_poor"),
    ("GPS accuracy degraded", "gps.eph", 9.0, "gps_poor"),
    ("high vibration", "vibration.accel", 50.0, "vibration_high"),
    ("estimator rejecting position", "ekf.pos_test_ratio", 3.0, "ekf_innovation_reject"),
]
DURATIONS = [1, 2, 3, 5, 10, 20]
conn = psycopg.connect(settings.dsn, autocommit=True, options="-c timezone=UTC")
conn.execute("DROP SCHEMA IF EXISTS inj CASCADE")
conn.execute("CREATE SCHEMA inj")
conn.execute("CREATE TABLE inj.telemetry (flight_id uuid NOT NULL, ts timestamptz NOT NULL, vendor_field_id smallint NOT NULL, value float8 NOT NULL)")
conn.execute("""CREATE VIEW inj.canonical AS SELECT t.flight_id, t.ts, c.key AS signal, t.value * m.scale + m."offset" AS value
                FROM inj.telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal'""")

mapping = {sig: conn.execute("SELECT m.vendor_field_id, m.scale, m.\"offset\" FROM field_mapping m JOIN concept c ON c.id = m.concept_id WHERE c.key = %s", (sig,)).fetchone() for _, sig, _, _ in FAULTS}
need = [sig for _, sig, _, _ in FAULTS]
ids = [r[0] for r in conn.execute("""SELECT s.flight_id FROM semantic.signal_summary s JOIN flight f ON f.id = s.flight_id
                                      WHERE s.signal = ANY(%s) AND f.duration_s >= 120 GROUP BY s.flight_id HAVING count(*) = %s ORDER BY s.flight_id LIMIT %s""",
                                   (need, len(need), a.flights)).fetchall()]
print(f"{len(ids)} flights with all injected signals", flush=True)
series = {}  # (flight, signal) -> (timestamps, canonical values)
for f in ids:
    for _, sig, _, _ in FAULTS:
        rows = conn.execute("SELECT ts, value FROM canonical_telemetry WHERE flight_id = %s AND signal = %s ORDER BY ts", (f, sig)).fetchall()
        series[(f, sig)] = (np.array([r[0].astimezone(timezone.utc).replace(tzinfo=None) for r in rows], dtype="datetime64[us]"), np.array([r[1] for r in rows]))


def insert(vid, sig, ts, canon):
    vf, scale, off = mapping[sig]
    raw = (canon - off) / scale
    with conn.cursor() as cur, cur.copy("COPY inj.telemetry (flight_id, ts, vendor_field_id, value) FROM STDIN") as cp:
        for t, v in zip(ts.astype("datetime64[us]").astype(object), raw):
            cp.write_row((vid, t.replace(tzinfo=timezone.utc), vf, float(v)))


variants = []  # (variant id, fault index, duration or 0 for control, window start, window end)
for f in ids:
    for fi, (label, sig, value, kind) in enumerate(FAULTS):
        ts, vals = series[(f, sig)]
        if len(ts) < 20:
            continue
        span = (ts[-1] - ts[0]) / np.timedelta64(1, "s")
        for d in [0] + DURATIONS:
            vid = str(uuid.uuid4())
            out = vals.copy()
            w0 = w1 = None
            if d:
                start = ts[0] + np.timedelta64(int(rng.uniform(0.2, 0.7) * span * 1e6), "us")
                w0, w1 = start, start + np.timedelta64(int(d * 1e6), "us")
                out[(ts >= w0) & (ts < w1)] = value
            insert(vid, sig, ts, out)
            variants.append((vid, fi, d, w0, w1))
print(f"{len(variants)} variants written (including controls)", flush=True)

TOL = np.timedelta64(1, "s")
cells, controls = {}, {}
for vid, fi, d, w0, w1 in variants:
    label, sig, value, kind = FAULTS[fi]
    evs = [e for e in rule_events(conn, vid, source="inj.canonical") if e["kind"] == kind]
    if d == 0:
        controls.setdefault(fi, []).append(len(evs) > 0)
        continue
    hit = [e for e in evs if np.datetime64(e["ts_end"].replace(tzinfo=None), "us") >= w0 - TOL and np.datetime64(e["ts_start"].replace(tzinfo=None), "us") <= w1 + TOL]
    onset = [(np.datetime64(e["ts_start"].replace(tzinfo=None), "us") - w0) / np.timedelta64(1, "ms") for e in hit]
    cells.setdefault((fi, d), []).append({"detected": bool(hit), "onset_ms": min(onset, key=abs) if onset else None, "extra_events": len(evs) - len(hit)})

# the shortest duration each rule can detect, from the rule table (a hold of d seconds sampled at the signal rate spans slightly less than d)
min_s = {}
for r in RULES:
    min_s[(r.signal, r.kind)] = min(r.min_s, min_s.get((r.signal, r.kind), 1e9))
result = {"taken_at": datetime.now(timezone.utc).isoformat(), "flights": len(ids), "durations_s": DURATIONS, "faults": []}
md = [f"# Fault injection: rule detectors on {len(ids)} real flights", "",
      "A constant fault value is held for the stated duration at a random time in the middle of a real flight; the unchanged rule engine then looks for the "
      "right event kind overlapping that window (1 s tolerance). Cells show the share of injected faults detected, with the median onset error in seconds. "
      "Controls are the same flights without injection. This tests the detectors' thresholds, minimum durations and sampling effects; it says nothing about "
      "whether the thresholds suit real faults.", "",
      "| fault | rule minimum | " + " | ".join(f"{d} s" for d in DURATIONS) + " | false alarms on controls |", "|---|---|" + "---|" * (len(DURATIONS) + 1)]
for fi, (label, sig, value, kind) in enumerate(FAULTS):
    row, js = [], {"fault": label, "signal": sig, "injected_value": value, "kind": kind, "by_duration": {}}
    for d in DURATIONS:
        cs = cells.get((fi, d), [])
        rate = float(np.mean([c["detected"] for c in cs])) if cs else None
        on = [c["onset_ms"] for c in cs if c["onset_ms"] is not None]
        med = float(np.median(on) / 1000) if on else None
        js["by_duration"][str(d)] = {"detection_rate": rate, "median_onset_error_s": med, "n": len(cs), "extra_events": int(sum(c["extra_events"] for c in cs))}
        row.append("n/a" if rate is None else f"{rate:.2f}" + (f" ({med:+.1f} s)" if med is not None else ""))
    fa = controls.get(fi, [])
    js["control_false_alarm_rate"] = float(np.mean(fa)) if fa else None
    js["control_n"] = len(fa)
    result["faults"].append(js)
    md.append(f"| {label} | {min_s.get((sig, kind), '?'):g} s | " + " | ".join(row) + f" | {js['control_false_alarm_rate']:.2f} of {len(fa)} |")
os.makedirs(a.out_dir, exist_ok=True)
json.dump(result, open(f"{a.out_dir}/injection_eval.json", "w"), indent=1)
open(f"{a.out_dir}/injection_eval.md", "w").write("\n".join(md) + "\n")
conn.execute("DROP SCHEMA inj CASCADE")
print("\n".join(md))
