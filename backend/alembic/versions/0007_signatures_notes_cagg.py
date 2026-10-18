"""flight signatures (similarity by signal shape), investigation notes, a 1-second continuous aggregate, optional NL-to-SQL login role

Revision ID: 0007
Revises: 0006

The continuous aggregate is created WITH NO DATA (fill it with scripts/refresh_semantic.py). The dedicated login role is created only
when NLSQL_DB_PASSWORD is set in the environment, so a default setup needs no new secret.
"""
import os

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE flight_signature (
        flight_id   uuid PRIMARY KEY REFERENCES flight(id) ON DELETE CASCADE,
        features    real[] NOT NULL,
        signature   vector(32) NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE TABLE signature_scaler (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), scaler jsonb NOT NULL, fitted_at timestamptz NOT NULL DEFAULT now())")

    op.execute("""
    CREATE TABLE note (
        id         bigserial PRIMARY KEY,
        flight_id  uuid NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
        t_s        double precision NOT NULL CHECK (t_s >= 0),
        body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
        created_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE INDEX note_flight ON note (flight_id, t_s)")

    with op.get_context().autocommit_block():  # continuous aggregates cannot be created inside a transaction block
        op.execute("""
        CREATE MATERIALIZED VIEW telemetry_1s WITH (timescaledb.continuous) AS
        SELECT time_bucket('1 second', ts) AS bucket, flight_id, vendor_field_id,
               min(value) AS lo, max(value) AS hi, avg(value) AS mean, count(*) AS n
        FROM telemetry GROUP BY 1, 2, 3 WITH NO DATA""")

    password = os.environ.get("NLSQL_DB_PASSWORD")
    if password:
        escaped = password.replace("'", "''")
        op.execute(f"""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uav_nlsql') THEN
                CREATE ROLE uav_nlsql LOGIN PASSWORD '{escaped}';
            ELSE
                ALTER ROLE uav_nlsql LOGIN PASSWORD '{escaped}';
            END IF;
        END $$""")
        op.execute("GRANT USAGE ON SCHEMA semantic TO uav_nlsql")
        op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA semantic TO uav_nlsql")
        op.execute("ALTER ROLE uav_nlsql SET statement_timeout = '8s'")
        op.execute("ALTER ROLE uav_nlsql SET default_transaction_read_only = on")
        op.execute("ALTER ROLE uav_nlsql SET idle_in_transaction_session_timeout = '10s'")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP MATERIALIZED VIEW IF EXISTS telemetry_1s")
    op.execute("DROP TABLE IF EXISTS note")
    op.execute("DROP TABLE IF EXISTS signature_scaler")
    op.execute("DROP TABLE IF EXISTS flight_signature")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uav_nlsql') THEN
        DROP OWNED BY uav_nlsql; DROP ROLE uav_nlsql; END IF; END $$""")
