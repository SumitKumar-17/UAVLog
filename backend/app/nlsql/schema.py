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
