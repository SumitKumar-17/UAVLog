"""Idempotently load the ontology and PX4 field mappings into Postgres."""
import psycopg

from app.config import settings
from app.ontology.seed_data import (
    ARDUPILOT_FIELDS, EVENTS, FAILURE_MODES, INDICATES, PX4_HOT_FIELDS, SIGNALS, SUBSYSTEMS,
)

with psycopg.connect(settings.dsn) as conn, conn.cursor() as cur:
    def upsert_concept(key, kind, label, unit=None, description=None):
        cur.execute(
            """INSERT INTO concept (key, kind, label, unit, description) VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, unit=EXCLUDED.unit,
               description=EXCLUDED.description RETURNING id""",
            (key, kind, label, unit, description),
        )
        return cur.fetchone()[0]

    ids = {}
    for k, d in SUBSYSTEMS.items():
        ids[k] = upsert_concept(k, "subsystem", k.replace("_", " ").title(), description=d)
    for k, d in FAILURE_MODES.items():
        ids[k] = upsert_concept(k, "failure_mode", k.replace("_", " ").title(), description=d)
    for k, (label, unit, sub) in SIGNALS.items():
        ids[k] = upsert_concept(k, "signal", label, unit)

    for k, (d, _) in EVENTS.items():
        ids[k] = upsert_concept(k, "event", k.replace("_", " ").title(), description=d)

    def relate(src, dst, rel):
        cur.execute("INSERT INTO concept_relation VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                    (ids[src], ids[dst], rel))

    for k, (_, _, sub) in SIGNALS.items():
        relate(k, sub, "part_of")
    for sig, fms in INDICATES.items():
        for fm in fms:
            relate(sig, fm, "indicates")

    for k, (_, fm) in EVENTS.items():
        if fm:
            relate(k, fm, "indicates")

    for topic, field, unit, sig, scale, offset in PX4_HOT_FIELDS:
        cur.execute(
            """INSERT INTO vendor_field (autopilot, topic, field, unit) VALUES ('px4',%s,%s,%s)
               ON CONFLICT (autopilot, topic, field) DO UPDATE SET unit=EXCLUDED.unit RETURNING id""",
            (topic, field, unit),
        )
        vf = cur.fetchone()[0]
        cur.execute(
            """INSERT INTO field_mapping (vendor_field_id, concept_id, scale, "offset") VALUES (%s,%s,%s,%s)
               ON CONFLICT (vendor_field_id, concept_id) DO UPDATE SET scale=EXCLUDED.scale, "offset"=EXCLUDED."offset" """,
            (vf, ids[sig], scale, offset),
        )
    for topic, field, unit, sig, scale, offset, note in ARDUPILOT_FIELDS:
        cur.execute(
            """INSERT INTO vendor_field (autopilot, topic, field, unit) VALUES ('ardupilot',%s,%s,%s)
               ON CONFLICT (autopilot, topic, field) DO UPDATE SET unit=EXCLUDED.unit RETURNING id""",
            (topic, field, unit),
        )
        vf = cur.fetchone()[0]
        cur.execute(
            """INSERT INTO field_mapping (vendor_field_id, concept_id, scale, "offset", note) VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (vendor_field_id, concept_id) DO UPDATE SET scale=EXCLUDED.scale, "offset"=EXCLUDED."offset", note=EXCLUDED.note""",
            (vf, ids[sig], scale, offset, note),
        )
    conn.commit()
    cur.execute("SELECT kind, count(*) FROM concept GROUP BY kind ORDER BY kind")
    print(dict(cur.fetchall()))
    cur.execute("SELECT count(*) FROM field_mapping")
    print("field mappings:", cur.fetchone()[0])
