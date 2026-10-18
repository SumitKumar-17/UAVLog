"""Threshold-rule events from telemetry via gaps-and-islands SQL. Thresholds are heuristics to be calibrated
against labelled flights; each rule is data, so tuning never requires code changes."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    kind: str          # event concept key
    signal: str        # canonical signal
    op: str            # one of < <= > >=
    threshold: float
    min_s: float       # minimum sustained duration
    severity: int
    text: str          # description template: {min} {max} {dur} {threshold}


RULES = [
    Rule("battery_low", "battery.remaining", "<", 20, 5, 1, "Battery below {threshold:g}% for {dur:.0f} s (lowest {min:.0f}%)"),
    Rule("battery_low", "battery.remaining", "<", 10, 3, 2, "Battery critically low, below {threshold:g}% for {dur:.0f} s (lowest {min:.0f}%)"),
    Rule("gps_poor", "gps.fix_type", "<", 3, 2, 2, "GPS lost 3D fix for {dur:.0f} s"),
    Rule("gps_poor", "gps.eph", ">", 5, 3, 1, "GPS horizontal accuracy worse than {threshold:g} m for {dur:.0f} s (worst {max:.1f} m)"),
    Rule("vibration_high", "vibration.accel", ">", 30, 3, 1, "High accelerometer vibration above {threshold:g} m/s^2 for {dur:.0f} s (peak {max:.0f})"),
    Rule("ekf_innovation_reject", "ekf.pos_test_ratio", ">", 1, 2, 1, "Estimator rejecting position measurements for {dur:.0f} s (peak ratio {max:.1f})"),
    Rule("ekf_innovation_reject", "ekf.vel_test_ratio", ">", 1, 2, 1, "Estimator rejecting velocity measurements for {dur:.0f} s (peak ratio {max:.1f})"),
    Rule("ekf_innovation_reject", "ekf.hgt_test_ratio", ">", 1, 2, 1, "Estimator rejecting height measurements for {dur:.0f} s (peak ratio {max:.1f})"),
]
OPS = {"<", "<=", ">", ">="}

ISLANDS = """
WITH s AS (SELECT ts, value, (value {op} %(thr)s) AS flag FROM canonical_telemetry
           WHERE flight_id = %(fid)s AND signal = %(sig)s),
g AS (SELECT *, row_number() OVER (ORDER BY ts) - row_number() OVER (PARTITION BY flag ORDER BY ts) AS grp FROM s)
SELECT min(ts), max(ts), min(value), max(value) FROM g WHERE flag
GROUP BY grp HAVING max(ts) - min(ts) >= make_interval(secs => %(min_s)s) ORDER BY 1"""


def rule_events(conn, flight_id) -> list[dict]:
    out = []
    for r in RULES:
        assert r.op in OPS
        for t0, t1, lo, hi in conn.execute(ISLANDS.format(op=r.op),
                                           {"thr": r.threshold, "fid": flight_id, "sig": r.signal, "min_s": r.min_s}):
            dur = (t1 - t0).total_seconds()
            out.append({"kind": r.kind, "ts_start": t0, "ts_end": t1, "severity": r.severity, "source": "rule",
                        "description": r.text.format(min=lo, max=hi, dur=dur, threshold=r.threshold),
                        "attrs": {"signal": r.signal, "op": r.op, "threshold": r.threshold, "min": lo, "max": hi}})
    return out
