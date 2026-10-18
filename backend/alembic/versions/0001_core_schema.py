"""core schema: extensions, ontology, semantic catalog, flights, telemetry hypertable

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ---- Ontology: Signal -> Subsystem -> Failure mode -> Event ----
    op.execute("""
    CREATE TABLE concept (
        id          serial PRIMARY KEY,
        key         text NOT NULL UNIQUE,
        kind        text NOT NULL CHECK (kind IN ('signal','subsystem','failure_mode','event')),
        label       text NOT NULL,
        description text,
        unit        text
    )""")
    op.execute("""
    CREATE TABLE concept_relation (
        src_id int NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
        dst_id int NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
        rel    text NOT NULL CHECK (rel IN ('part_of','indicates','causes','measures')),
        PRIMARY KEY (src_id, dst_id, rel)
    )""")
    op.execute("CREATE INDEX concept_relation_dst ON concept_relation (dst_id, rel)")

    # ---- Semantic catalog: vendor fields and their mapping to concepts ----
    op.execute("""
    CREATE TABLE vendor_field (
        id        smallserial PRIMARY KEY,
        autopilot text NOT NULL CHECK (autopilot IN ('px4','ardupilot')),
        topic     text NOT NULL,
        field     text NOT NULL,
        unit      text,
        UNIQUE (autopilot, topic, field)
    )""")
    op.execute("""
    CREATE TABLE field_mapping (
        vendor_field_id smallint NOT NULL REFERENCES vendor_field(id) ON DELETE CASCADE,
        concept_id      int      NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
        scale           double precision NOT NULL DEFAULT 1,
        "offset"        double precision NOT NULL DEFAULT 0,
        note            text,
        PRIMARY KEY (vendor_field_id, concept_id)
    )""")

    # ---- Flights ----
    op.execute("""
    CREATE TABLE flight (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source       text NOT NULL,
        source_ref   text,
        autopilot    text NOT NULL CHECK (autopilot IN ('px4','ardupilot')),
        firmware     text,
        vehicle_type text,
        started_at   timestamptz NOT NULL,
        duration_s   double precision,
        log_sha256   text NOT NULL UNIQUE,
        parquet_path text,
        metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
        ingested_at  timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE INDEX flight_started_at ON flight (started_at)")
    op.execute("CREATE INDEX flight_metadata_gin ON flight USING gin (metadata jsonb_path_ops)")

    # ---- Telemetry: only ontology-mapped ("hot") fields; full-rate raw stays in Parquet ----
    op.execute("""
    CREATE TABLE telemetry (
        flight_id       uuid     NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
        ts              timestamptz NOT NULL,
        vendor_field_id smallint NOT NULL REFERENCES vendor_field(id),
        value           double precision NOT NULL
    )""")
    op.execute("""
    SELECT create_hypertable('telemetry', by_range('ts', INTERVAL '7 days'))
    """)
    op.execute("CREATE INDEX telemetry_flight_field_ts ON telemetry (flight_id, vendor_field_id, ts DESC)")

    # ---- Semantic view: telemetry expressed in canonical concepts ----
    op.execute("""
    CREATE VIEW canonical_telemetry AS
    SELECT t.flight_id, t.ts, c.key AS signal, t.value * m.scale + m."offset" AS value, c.unit
    FROM telemetry t
    JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
    JOIN concept c       ON c.id = m.concept_id AND c.kind = 'signal'
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS canonical_telemetry")
    for t in ("telemetry", "flight", "field_mapping", "vendor_field", "concept_relation", "concept"):
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
