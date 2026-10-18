"""Parse a PX4 ULog: write every topic to Parquet and extract the ontology-mapped ("hot") series."""
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from pyulog import ULog

from app.ontology.seed_data import PX4_HOT_FIELDS

HOT_BY_TOPIC: dict[str, list[str]] = {}
for _topic, _field, *_ in PX4_HOT_FIELDS:
    HOT_BY_TOPIC.setdefault(_topic, []).append(_field)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def euler_deg(q: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Quaternion (w,x,y,z) to roll/pitch/yaw in degrees (aerospace ZYX)."""
    w, x, y, z = (q[f"q[{i}]"] for i in range(4))
    roll = np.arctan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    pitch = np.arcsin(np.clip(2 * (w * y - z * x), -1, 1))
    yaw = np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return {"roll_deg": np.degrees(roll), "pitch_deg": np.degrees(pitch), "yaw_deg": np.degrees(yaw)}


MIN_VALID_UTC = datetime(2015, 1, 1, tzinfo=timezone.utc)  # older firmware reports tiny bogus GPS times


def start_time_utc(u: ULog, fallback: str) -> datetime:
    """Log start in UTC from the first plausible GPS time; falls back to the index date (midnight)."""
    for d in u.data_list:
        if d.name == "vehicle_gps_position" and d.multi_id == 0:
            utc = d.data["time_utc_usec"]
            ok = np.nonzero(utc > 0)[0]
            if len(ok):
                i = ok[0]
                boot_us = int(d.data["timestamp"][i]) - u.start_timestamp
                t0 = datetime.fromtimestamp((int(utc[i]) - boot_us) / 1e6, tz=timezone.utc)
                if MIN_VALID_UTC <= t0 <= datetime.now(timezone.utc) + timedelta(days=1):
                    return t0
    return datetime.fromisoformat(fallback).replace(tzinfo=timezone.utc)


def robust_duration_s(u: ULog) -> float:
    """Log length from the data alone. u.last_timestamp is the max over every message, so one message with a garbage
    timestamp (seen: 1.4e13 s) ruins it; the 75th percentile of each topic's last timestamp is not moved by a few outliers."""
    lasts = [int(d.data["timestamp"][-1]) for d in u.data_list if len(d.data["timestamp"])]
    return (float(np.percentile(lasts, 75)) - u.start_timestamp) / 1e6 if lasts else 0.0


def process(path: str, rec: dict, parquet_root: str) -> dict:
    """Parse one log. Returns flight metadata plus hot series as (topic, field, ts_us, values)."""
    path = Path(path)
    u = ULog(str(path))
    log_id = rec["log_id"]
    t0 = start_time_utc(u, rec["log_date"])

    hot, topics = [], 0
    for d in u.data_list:
        out = Path(parquet_root) / f"topic={d.name}" / f"log_id={log_id}"
        out.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.table(d.data), out / f"part-{d.multi_id}.parquet", compression="zstd")
        topics += 1
        if d.multi_id != 0 or d.name not in HOT_BY_TOPIC:
            continue
        data = dict(d.data)
        if d.name == "vehicle_attitude":
            data.update(euler_deg(d.data))
        ts_us = d.data["timestamp"].astype(np.int64) - u.start_timestamp
        for field in HOT_BY_TOPIC[d.name]:
            if field in data:
                hot.append((d.name, field, ts_us, data[field].astype(np.float64)))

    # Prefer the Flight Review index duration (it handles these corrupt timestamps); fall back to the robust estimate.
    parsed = robust_duration_s(u)
    index_dur = rec.get("duration_s")
    duration = float(index_dur) if index_dur else parsed

    meta = {k: rec.get(k) for k in (
        "description", "feedback", "rating", "error_labels", "wind_speed", "sys_hw", "ver_sw_release",
        "airframe_name", "num_logged_errors", "num_logged_warnings", "flight_mode_durations", "stratum")}
    meta["duration_parsed_s"] = round(parsed, 1)
    meta["duration_source"] = "index" if index_dur else "parsed"
    return {
        "log_id": log_id, "sha256": sha256(path), "t0": t0, "topics": topics,
        "duration_s": duration,
        "firmware": rec.get("ver_sw_release"), "vehicle_type": rec.get("mav_type"),
        "metadata": meta, "parquet_path": parquet_root, "hot": hot,
    }
