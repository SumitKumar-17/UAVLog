"""semantic layer for NL-to-SQL: curated documented views and read-only roles

Revision ID: 0006
Revises: 0005

The views are the only objects the NL-to-SQL role can read. Column comments are the documentation the prompt is built from,
so the model's view of the data lives in the database, next to the data.
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA semantic")

    op.execute("""
    CREATE VIEW semantic.flights AS
    SELECT f.id AS flight_id, f.source_ref AS log_id, f.started_at, f.duration_s,
           f.metadata->>'sys_hw' AS board, f.firmware,
           NULLIF(f.metadata->>'rating', '') AS pilot_rating,
           NULLIF(btrim(f.metadata->>'feedback'), '') AS pilot_feedback,
           (SELECT array_agg(CASE l::int WHEN 1 THEN 'other' WHEN 2 THEN 'vibration' WHEN 3 THEN 'airframe design'
                    WHEN 4 THEN 'sensor error' WHEN 5 THEN 'component failure' WHEN 6 THEN 'software'
                    WHEN 7 THEN 'human error' WHEN 8 THEN 'external conditions' END ORDER BY l::int)
              FROM jsonb_array_elements_text(f.metadata->'error_labels') l) AS pilot_error_labels
    FROM flight f""")
    op.execute("COMMENT ON VIEW semantic.flights IS 'One row per flight (a PX4 flight log from Flight Review).'")
    for col, doc in {
        "flight_id": "Unique flight id; join key to events, telemetry and signal_summary.",
        "log_id": "Flight Review log id (the public identifier).",
        "started_at": "UTC time the log started.",
        "duration_s": "Length of the log in seconds.",
        "board": "Flight controller hardware name, e.g. PX4_FMU_V6X.",
        "firmware": "PX4 release the flight ran.",
        "pilot_rating": "Rating the pilot gave the flight (good, crash_pilot, crash_sw_hw, ...). Mostly NULL.",
        "pilot_feedback": "Free-text note from the pilot. Mostly NULL.",
        "pilot_error_labels": "Causes the pilot selected (vibration, sensor error, component failure, ...). Mostly NULL.",
    }.items():
        op.execute(f"COMMENT ON COLUMN semantic.flights.{col} IS '{doc}'")

    op.execute("""
    CREATE VIEW semantic.events AS
    SELECT e.id AS event_id, e.flight_id, c.key AS kind,
           e.severity, CASE e.severity WHEN 2 THEN 'critical' WHEN 1 THEN 'warning' ELSE 'info' END AS severity_label,
           extract(epoch FROM e.ts_start - f.started_at) AS start_s, extract(epoch FROM e.ts_end - f.started_at) AS end_s,
           e.description, e.source, fm.key AS failure_mode
    FROM event e JOIN concept c ON c.id = e.kind_id JOIN flight f ON f.id = e.flight_id
    LEFT JOIN concept_relation r ON r.src_id = c.id AND r.rel = 'indicates'
    LEFT JOIN concept fm ON fm.id = r.dst_id AND fm.kind = 'failure_mode'""")
    op.execute("COMMENT ON VIEW semantic.events IS 'Things that happened during a flight: mode changes, arming, takeoff and landing, failsafes, autopilot warnings and errors, and threshold violations our rules found.'")
    for col, doc in {
        "event_id": "Unique event id.",
        "flight_id": "Flight this event belongs to (join to flights).",
        "kind": "Event type: takeoff, landing, arm, disarm, mode_change, failsafe_activated, log_error, log_warning, battery_low, gps_poor, vibration_high, ekf_innovation_reject, motor_failure_detected, imbalanced_prop_detected, attitude_limit_exceeded.",
        "severity": "0 info, 1 warning, 2 critical.",
        "severity_label": "info, warning or critical.",
        "start_s": "Seconds since the log started when the event began.",
        "end_s": "Seconds since the log started when the event ended (equals start_s for instant events).",
        "description": "Human-readable text of the event.",
        "source": "Where the event came from: vehicle_status, vehicle_land_detected, failure_detector_status, log_message or rule.",
        "failure_mode": "Failure mode this event is evidence for (low_battery, gps_degraded, high_vibration, ekf_rejection, motor_failure, motor_imbalance, attitude_loss) or NULL.",
    }.items():
        op.execute(f"COMMENT ON COLUMN semantic.events.{col} IS '{doc}'")

    op.execute("""
    CREATE VIEW semantic.signals AS
    SELECT s.key AS signal, s.label, s.unit, sub.key AS subsystem
    FROM concept s LEFT JOIN concept_relation r ON r.src_id = s.id AND r.rel = 'part_of'
    LEFT JOIN concept sub ON sub.id = r.dst_id AND sub.kind = 'subsystem'
    WHERE s.kind = 'signal'""")
    op.execute("COMMENT ON VIEW semantic.signals IS 'The canonical telemetry signals (autopilot-independent names).'")
    op.execute("COMMENT ON COLUMN semantic.signals.signal IS 'Canonical signal name, e.g. battery.voltage, attitude.roll, vibration.accel.'")
    op.execute("COMMENT ON COLUMN semantic.signals.unit IS 'Unit of the value column (V, A, %, deg, m, m/s, m/s^2, ...).'")
    op.execute("COMMENT ON COLUMN semantic.signals.subsystem IS 'power, navigation, attitude, propulsion, imu, estimation or flight_state.'")

    op.execute("""
    CREATE VIEW semantic.telemetry AS
    SELECT t.flight_id, extract(epoch FROM t.ts - f.started_at) AS t_s, c.key AS signal,
           t.value * m.scale + m."offset" AS value
    FROM telemetry t JOIN flight f ON f.id = t.flight_id
    JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
    JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal'""")
    op.execute("COMMENT ON VIEW semantic.telemetry IS 'Raw time series, about 70 million rows. ALWAYS filter by flight_id and signal; prefer signal_summary for questions across flights.'")
    op.execute("COMMENT ON COLUMN semantic.telemetry.t_s IS 'Seconds since the log started.'")
    op.execute("COMMENT ON COLUMN semantic.telemetry.signal IS 'Canonical signal name (see signals).'")
    op.execute("COMMENT ON COLUMN semantic.telemetry.value IS 'Value in the signal unit (see signals.unit).'")

    # per flight and signal, precomputed (refreshed by scripts/refresh_semantic.py); cheap to scan across all flights
    op.execute("""
    CREATE MATERIALIZED VIEW semantic.signal_summary AS
    SELECT t.flight_id, c.key AS signal, min(t.value * m.scale + m."offset") AS min_value,
           max(t.value * m.scale + m."offset") AS max_value, avg(t.value * m.scale + m."offset") AS mean_value,
           count(*) AS samples
    FROM telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
    JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal'
    GROUP BY t.flight_id, c.key WITH NO DATA""")
    op.execute("CREATE UNIQUE INDEX signal_summary_pk ON semantic.signal_summary (flight_id, signal)")
    op.execute("COMMENT ON MATERIALIZED VIEW semantic.signal_summary IS 'Lowest, highest and mean value of every signal in every flight. Use this to compare flights; it is fast.'")
    op.execute("COMMENT ON COLUMN semantic.signal_summary.min_value IS 'Lowest value of the signal during the flight.'")
    op.execute("COMMENT ON COLUMN semantic.signal_summary.max_value IS 'Highest value of the signal during the flight.'")
    op.execute("COMMENT ON COLUMN semantic.signal_summary.mean_value IS 'Mean value of the signal during the flight.'")
    op.execute("COMMENT ON COLUMN semantic.signal_summary.samples IS 'Number of samples.'")

    op.execute("""
    CREATE VIEW semantic.ontology AS
    SELECT s.key AS concept, s.kind AS concept_kind, r.rel AS relation, d.key AS related_concept, d.kind AS related_kind
    FROM concept_relation r JOIN concept s ON s.id = r.src_id JOIN concept d ON d.id = r.dst_id""")
    op.execute("COMMENT ON VIEW semantic.ontology IS 'How concepts relate: signal part_of subsystem; signal or event indicates failure_mode.'")

    # read-only role for the API: sees only the semantic views
    op.execute("CREATE ROLE uav_reader NOLOGIN")
    op.execute("GRANT USAGE ON SCHEMA semantic TO uav_reader")
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA semantic TO uav_reader")
    op.execute("GRANT uav_reader TO CURRENT_USER")

    # benchmark-only role for the 'raw schema' baseline of experiment 5; never used by the API
    op.execute("CREATE ROLE uav_reader_raw NOLOGIN")
    op.execute("GRANT SELECT ON telemetry, vendor_field, field_mapping, concept, concept_relation, event, flight TO uav_reader_raw")
    op.execute("GRANT uav_reader_raw TO CURRENT_USER")


def downgrade() -> None:
    op.execute("DROP OWNED BY uav_reader_raw")
    op.execute("DROP ROLE IF EXISTS uav_reader_raw")
    op.execute("DROP OWNED BY uav_reader")
    op.execute("DROP ROLE IF EXISTS uav_reader")
    op.execute("DROP SCHEMA IF EXISTS semantic CASCADE")
