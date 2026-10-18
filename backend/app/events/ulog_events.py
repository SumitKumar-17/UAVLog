"""Events from ULog state transitions and logged messages. State enums verified against PX4-msgs VehicleStatus.msg."""
import re
from datetime import datetime, timedelta

import numpy as np
from pyulog import ULog

NAV_STATE = {
    0: "Manual", 1: "Altitude", 2: "Position", 3: "Mission", 4: "Hold", 5: "Return", 6: "Position slow",
    10: "Acro", 12: "Descend", 13: "Termination", 14: "Offboard", 15: "Stabilized", 17: "Takeoff", 18: "Land",
    19: "Follow target", 20: "Precision land", 21: "Orbit", 22: "VTOL takeoff",
}
LOG_KIND = {"EMERGENCY": ("log_error", 2), "ALERT": ("log_error", 2), "CRITICAL": ("log_error", 2),
            "ERROR": ("log_error", 2), "WARNING": ("log_warning", 1)}
MAX_LOG_EVENTS = 50
TOPICS = ["vehicle_status", "vehicle_land_detected", "failure_detector_status"]
# failure_detector_status flag -> (event kind, label); fd_alt/fd_ext/fd_battery never fired in our 300 logs
FD_FLAGS = {
    "fd_roll": ("attitude_limit_exceeded", "roll angle exceeded the safe limit"),
    "fd_pitch": ("attitude_limit_exceeded", "pitch angle exceeded the safe limit"),
    "fd_motor": ("motor_failure_detected", "motor failure"),
    "fd_arm_escs": ("motor_failure_detected", "ESC failed to arm"),
    "fd_imbalanced_prop": ("imbalanced_prop_detected", "imbalanced propeller"),
}


def _mode(v: int) -> str:
    return NAV_STATE.get(int(v), f"mode {int(v)}")


def _changes(arr: np.ndarray) -> np.ndarray:
    return np.nonzero(np.diff(arr.astype(np.int64)) != 0)[0] + 1


def _runs(flag: np.ndarray) -> list[tuple[int, int]]:
    """(first, last) sample index of every contiguous run where the flag is true."""
    d = np.diff(np.concatenate(([0], (flag != 0).astype(np.int8), [0])))
    return list(zip(np.nonzero(d == 1)[0].tolist(), (np.nonzero(d == -1)[0] - 1).tolist()))


def extract(path: str, started_at: datetime) -> list[dict]:
    u = ULog(path, message_name_filter_list=TOPICS)
    at = lambda us: started_at + timedelta(microseconds=int(us) - u.start_timestamp)  # noqa: E731
    out: list[dict] = []

    def add(kind, ts, sev, source, desc, **attrs):
        out.append({"kind": kind, "ts_start": ts, "ts_end": attrs.pop("ts_end", ts), "severity": sev,
                    "source": source, "description": desc, "attrs": attrs})

    by = {d.name: d.data for d in u.data_list if d.multi_id == 0}
    if "vehicle_status" in by:
        d = by["vehicle_status"]
        t = d["timestamp"]
        for i in _changes(d["nav_state"]) if "nav_state" in d else []:
            a, b = _mode(d["nav_state"][i - 1]), _mode(d["nav_state"][i])
            add("mode_change", at(t[i]), 0, "vehicle_status", f"Flight mode changed from {a} to {b}", **{"from": a, "to": b})
        for i in _changes(d["arming_state"]) if "arming_state" in d else []:
            armed = int(d["arming_state"][i]) == 2
            add("arm" if armed else "disarm", at(t[i]), 0, "vehicle_status", "Motors armed" if armed else "Motors disarmed")
        if "failsafe" in d and "nav_state" in d:
            for i in _changes(d["failsafe"]):
                if d["failsafe"][i]:
                    m = _mode(d["nav_state"][i])
                    add("failsafe_activated", at(t[i]), 2, "vehicle_status", f"Failsafe activated while in {m} mode", mode=m)
    if "vehicle_land_detected" in by:
        d = by["vehicle_land_detected"]
        for i in _changes(d["landed"]):
            took_off = not d["landed"][i]
            add("takeoff" if took_off else "landing", at(d["timestamp"][i]), 0, "vehicle_land_detected",
                "Vehicle took off" if took_off else "Vehicle landed")

    if "failure_detector_status" in by:
        d = by["failure_detector_status"]
        t = d["timestamp"]
        for flag, (kind, label) in FD_FLAGS.items():
            for s0, e0 in _runs(d[flag]) if flag in d else []:
                desc, extra = f"Failure detector: {label} for {(t[e0] - t[s0]) / 1e6:.0f} s", {}
                if flag == "fd_imbalanced_prop" and "imbalanced_prop_metric" in d:
                    extra["metric_peak"] = float(np.max(d["imbalanced_prop_metric"][s0:e0 + 1]))
                    desc += f" (imbalance metric peak {extra['metric_peak']:.2f})"
                if flag == "fd_motor" and "motor_failure_mask" in d:
                    mask = int(np.bitwise_or.reduce(d["motor_failure_mask"][s0:e0 + 1].astype(np.int64)))
                    extra["failed_motors"] = [i + 1 for i in range(16) if mask >> i & 1]
                    desc += f", motors {extra['failed_motors']}"
                add(kind, at(t[s0]), 2, "failure_detector_status", desc, ts_end=at(t[e0]), flag=flag, **extra)

    # De-duplicate log messages that differ only in numbers (timestamps, counters): keep the first, count the rest.
    seen: dict[str, dict] = {}
    for m in u.logged_messages:
        kind = LOG_KIND.get(m.log_level_str().upper())
        text = m.message.replace("\t", " ").strip()
        if not kind or not text:
            continue
        key = re.sub(r"\d+", "#", text)
        if key in seen:
            seen[key]["attrs"]["count"] += 1
            seen[key]["ts_end"] = at(m.timestamp)
            continue
        if len(seen) >= MAX_LOG_EVENTS:
            continue
        add(kind[0], at(m.timestamp), kind[1], "log_message", text, count=1, level=m.log_level_str())
        seen[key] = out[-1]
    for e in seen.values():
        if e["attrs"]["count"] > 1:
            e["description"] += f" (repeated {e['attrs']['count']} times)"
    return out
