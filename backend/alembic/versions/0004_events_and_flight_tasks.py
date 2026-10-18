"""events and the per-flight task queue shared by all post-ingest stages

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE flight_task (
        flight_id   uuid NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
        stage       text NOT NULL,
        status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
        attempts    int NOT NULL DEFAULT 0,
        last_error  text,
        worker      text,
        claimed_at  timestamptz,
        finished_at timestamptz,
        result      jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (flight_id, stage)
    )""")
    op.execute("CREATE INDEX flight_task_claim ON flight_task (stage, status, created_at)")

    op.execute("""
    CREATE TABLE event (
        id          bigserial PRIMARY KEY,
        flight_id   uuid NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
        kind_id     int  NOT NULL REFERENCES concept(id),
        ts_start    timestamptz NOT NULL,
        ts_end      timestamptz NOT NULL,
        severity    smallint NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 2),
        source      text NOT NULL,
        attrs       jsonb NOT NULL DEFAULT '{}'::jsonb,
        description text NOT NULL,
        tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', description)) STORED
    )""")
    op.execute("CREATE INDEX event_flight_ts ON event (flight_id, ts_start)")
    op.execute("CREATE INDEX event_kind_ts ON event (kind_id, ts_start)")
    op.execute("CREATE INDEX event_tsv ON event USING gin (tsv)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS event")
    op.execute("DROP TABLE IF EXISTS flight_task")
