"""Events from ULog state transitions and logged messages. State enums verified against PX4-msgs VehicleStatus.msg."""
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
TOPICS = ["vehicle_status", "vehicle_land_detected"]


def _mode(v: int) -> str:
    return NAV_STATE.get(int(v), f"mode {int(v)}")


def _changes(arr: np.ndarray) -> np.ndarray:
    return np.nonzero(np.diff(arr.astype(np.int64)) != 0)[0] + 1


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
        for i in _changes(d["nav_state"]):
            a, b = _mode(d["nav_state"][i - 1]), _mode(d["nav_state"][i])
            add("mode_change", at(t[i]), 0, "vehicle_status", f"Flight mode changed from {a} to {b}", **{"from": a, "to": b})
        for i in _changes(d["arming_state"]):
            armed = int(d["arming_state"][i]) == 2
            add("arm" if armed else "disarm", at(t[i]), 0, "vehicle_status", "Motors armed" if armed else "Motors disarmed")
        if "failsafe" in d:
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

    seen: dict[str, dict] = {}
    for m in u.logged_messages:
        kind = LOG_KIND.get(m.log_level_str().upper())
        text = m.message.replace("\t", " ").strip()
        if not kind or not text:
            continue
        if text in seen:
            seen[text]["attrs"]["count"] += 1
            seen[text]["ts_end"] = at(m.timestamp)
            continue
        if len(seen) >= MAX_LOG_EVENTS:
            continue
        add(kind[0], at(m.timestamp), kind[1], "log_message", text, count=1, level=m.log_level_str())
        seen[text] = out[-1]
    return out
