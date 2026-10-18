"""Parse a MAVLink telemetry log (.tlog, as written by ArduPilot ground stations) into the same hot-series shape as the ULog parser."""
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pymavlink import mavutil

from app.ontology.seed_data import ARDUPILOT_FIELDS

WANTED: dict[str, list[str]] = {}
for _topic, _field, *_ in ARDUPILOT_FIELDS:
    WANTED.setdefault(_topic, []).append(_field)

# MAVLink uses sentinel values for "unknown"; they must not become data
INVALID = {
    ("SYS_STATUS", "voltage_battery"): lambda v: v in (0, 65535),
    ("SYS_STATUS", "current_battery"): lambda v: v < 0,
    ("SYS_STATUS", "battery_remaining"): lambda v: v < 0,
    ("GPS_RAW_INT", "lat"): lambda v: v == 0,
    ("GPS_RAW_INT", "lon"): lambda v: v == 0,
    ("GPS_RAW_INT", "satellites_visible"): lambda v: v == 255,
}


def parse(path: str, source_url: str | None = None) -> dict:
    p = Path(path)
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    link = mavutil.mavlink_connection(str(p), dialect="ardupilotmega")
    ts: dict[tuple[str, str], list[float]] = {}
    vals: dict[tuple[str, str], list[float]] = {}
    first = last = None
    vehicle_type = None
    while (msg := link.recv_match(blocking=False)) is not None:
        kind = msg.get_type()
        t = getattr(msg, "_timestamp", None)
        if kind == "BAD_DATA" or not t:
            continue
        first = first or t
        last = t
        if kind == "HEARTBEAT" and vehicle_type is None:
            vehicle_type = int(msg.type)
        for field in WANTED.get(kind, ()):
            v = getattr(msg, field, None)
            if v is None or INVALID.get((kind, field), lambda _: False)(v):
                continue
            ts.setdefault((kind, field), []).append(t)
            vals.setdefault((kind, field), []).append(float(v))
    if first is None:
        raise ValueError("no MAVLink messages found")
    hot = [(k[0], k[1], ((np.array(ts[k]) - first) * 1e6).astype(np.int64), np.array(vals[k])) for k in ts]
    return {
        "source": "mavlink_sample", "autopilot": "ardupilot", "log_id": f"mavlink-{sha[:12]}", "sha256": sha,
        "t0": datetime.fromtimestamp(first, tz=timezone.utc), "duration_s": float(last - first), "topics": len(set(k[0] for k in ts)),
        "firmware": None, "vehicle_type": "VTOL (simulated)" if vehicle_type == 1 else f"MAVLink vehicle type {vehicle_type}",
        "metadata": {"description": "ArduPilot SITL VTOL sample flight (simulated, not a real aircraft)", "sys_hw": "ARDUPILOT_SITL", "simulated": True,
                     "mavlink_vehicle_type": vehicle_type, "source_url": source_url, "stratum": "second-autopilot sample"},
        "parquet_path": None, "hot": hot, "elapsed_s": 0.0,
    }
