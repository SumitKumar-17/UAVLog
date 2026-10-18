"""Builds the model's view of the data from the database itself: view and column comments of the semantic schema, plus the
live vocabulary (event kinds, signals). Documentation lives next to the data, so it cannot drift."""
CATALOG = """
SELECT c.relname AS view, obj_description(c.oid, 'pg_class') AS view_doc, a.attname AS col,
       format_type(a.atttypid, a.atttypmod) AS type, col_description(c.oid, a.attnum) AS col_doc
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'semantic' AND c.relkind IN ('v', 'm') ORDER BY c.relname, a.attnum"""

RAW_SCHEMA = """Tables (PostgreSQL, schema public):
flight(id uuid, source text, source_ref text, autopilot text, firmware text, vehicle_type text, started_at timestamptz, duration_s float8, log_sha256 text, parquet_path text, metadata jsonb, ingested_at timestamptz)
telemetry(flight_id uuid, ts timestamptz, vendor_field_id smallint, value float8)   -- about 70 million rows
vendor_field(id smallint, autopilot text, topic text, field text, unit text)
field_mapping(vendor_field_id smallint, concept_id int, scale float8, "offset" float8, note text)
concept(id int, key text, kind text, label text, description text, unit text)
concept_relation(src_id int, dst_id int, rel text)
event(id bigint, flight_id uuid, kind_id int, ts_start timestamptz, ts_end timestamptz, severity smallint, source text, attrs jsonb, description text)"""


def semantic_schema(conn) -> str:
    out, last = [], None
    for view, vdoc, col, typ, cdoc in conn.execute(CATALOG).fetchall():
        if view != last:
            out.append(f"\nsemantic.{view}  -- {vdoc}")
            last = view
        out.append(f"  {col} {typ}" + (f"  -- {cdoc}" if cdoc else ""))
    signals = conn.execute("SELECT signal || ' (' || coalesce(unit, '') || ')' FROM semantic.signals ORDER BY signal").fetchall()
    out.append("\nSignal names for telemetry.signal and signal_summary.signal: " + ", ".join(r[0] for r in signals))
    return "\n".join(out).strip()


# Same information content as the semantic layer's comments, but written against the raw tables: separates the effect of
# documentation from the effect of the view structure (renamed columns, offsets in seconds, precomputed summary).
RAW_NOTES = """
Notes on the raw tables:
- flight.metadata (jsonb) keys: sys_hw (board name), rating (pilot rating text; 'none' if unrated), feedback (pilot note), error_labels (JSON array of integer cause codes: 1 other, 2 vibration, 3 airframe design, 4 sensor error, 5 component failure, 6 software, 7 human error, 8 external conditions).
- event.kind_id references concept.id. Event kinds are concept rows with kind = 'event' and key one of: takeoff, landing, arm, disarm, mode_change, failsafe_activated, log_error, log_warning, battery_low, gps_poor, vibration_high, ekf_innovation_reject, motor_failure_detected, imbalanced_prop_detected, attitude_limit_exceeded.
- event.severity: 0 info, 1 warning, 2 critical. Seconds since the log started = extract(epoch from event.ts_start - flight.started_at).
- Failure modes are concept rows with kind = 'failure_mode'. concept_relation(src_id, dst_id, rel): rel 'part_of' links a signal to its subsystem; rel 'indicates' links a signal or an event kind to a failure mode.
- Telemetry signals are concept rows with kind = 'signal' (keys like battery.voltage, vibration.accel, gps.eph, attitude.roll). Value in canonical units = telemetry.value * field_mapping.scale + field_mapping."offset", joining telemetry.vendor_field_id = field_mapping.vendor_field_id and field_mapping.concept_id = concept.id. telemetry has about 70 million rows: always filter by signal, and aggregate per flight before joining across flights."""
RAW_DOCS_SCHEMA = RAW_SCHEMA + "\n" + RAW_NOTES
