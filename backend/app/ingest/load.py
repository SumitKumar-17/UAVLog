"""Shared loader: one flight and its telemetry into the database, whatever the log format.

The caller supplies `vf_ids`, a map from (topic, field) to vendor_field.id for that autopilot."""
import io
import json

import numpy as np
import pyarrow as pa
import pyarrow.csv as pacsv


def telemetry_table(r: dict, vf_ids: dict, fid: str) -> pa.Table | None:
    t0_us = np.datetime64(r["t0"].replace(tzinfo=None), "us")
    parts = []
    for topic, field, ts_us, vals in r["hot"]:
        ok = np.isfinite(vals)
        parts.append(pa.table({
            "ts": pa.array(t0_us + ts_us[ok].astype("timedelta64[us]"), pa.timestamp("us")),
            "vf": pa.array(np.full(int(ok.sum()), vf_ids[(topic, field)], np.int16)),
            "value": vals[ok],
        }))
    if not parts:
        return None
    t = pa.concat_tables(parts)
    return t.add_column(0, "flight_id", pa.repeat(pa.scalar(fid), t.num_rows))


def load(conn, vf_ids, r) -> int:
    """Insert flight + telemetry and mark the job done in ONE transaction. `r` comes from a format-specific parser (ULog or MAVLink);
    its optional keys `source` and `autopilot` default to the Flight Review PX4 case."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """INSERT INTO flight (source, source_ref, autopilot, firmware, vehicle_type, started_at,
               duration_s, log_sha256, parquet_path, metadata)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (log_sha256) DO NOTHING RETURNING id""",
            (r.get("source", "flight_review"), r["log_id"], r.get("autopilot", "px4"), r["firmware"], r["vehicle_type"], r["t0"], r["duration_s"],
             r["sha256"], r["parquet_path"], json.dumps(r["metadata"], default=str)),
        )
        row, n = cur.fetchone(), 0
        if row is not None:  # None = identical log content already loaded under another id
            t = telemetry_table(r, vf_ids, str(row[0]))
            if t is not None:
                n = t.num_rows
                with cur.copy("COPY telemetry (flight_id, ts, vendor_field_id, value) FROM STDIN (FORMAT csv)") as cp:
                    for off in range(0, n, 1_000_000):
                        buf = io.BytesIO()
                        pacsv.write_csv(t.slice(off, 1_000_000), buf, pacsv.WriteOptions(include_header=False))
                        cp.write(buf.getvalue())
        cur.execute(
            "UPDATE ingest_job SET status='done', finished_at=now(), rows_loaded=%s, elapsed_s=%s, last_error=NULL "
            "WHERE log_id=%s", (n, r["elapsed_s"], r["log_id"]))
    return n
