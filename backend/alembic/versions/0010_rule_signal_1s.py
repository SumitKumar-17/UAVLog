"""one-second lo/hi of the signals the threshold rules use, so rules can be tuned and evaluated live over every flight

Revision ID: 0010
Revises: 0009

Created WITH NO DATA; scripts/refresh_semantic.py fills it (the first fill reads only the segments of these signals).
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

SIGNALS = ("battery.remaining", "gps.fix_type", "gps.eph", "vibration.accel", "ekf.pos_test_ratio", "ekf.vel_test_ratio", "ekf.hgt_test_ratio")


def upgrade() -> None:
    op.execute(f"""
    CREATE MATERIALIZED VIEW rule_signal_1s AS
    SELECT t.flight_id, c.key AS signal, floor(extract(epoch FROM t.ts - f.started_at))::int AS sec,
           min(t.value * m.scale + m."offset") AS lo, max(t.value * m.scale + m."offset") AS hi
    FROM telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
    JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal' AND c.key IN ({", ".join(repr(s) for s in SIGNALS)})
    JOIN flight f ON f.id = t.flight_id
    GROUP BY 1, 2, 3 WITH NO DATA""")
    op.execute("CREATE UNIQUE INDEX rule_signal_1s_pk ON rule_signal_1s (flight_id, signal, sec)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS rule_signal_1s")
