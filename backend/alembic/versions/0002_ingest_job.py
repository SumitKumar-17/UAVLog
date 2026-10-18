"""ingest job queue

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE ingest_job (
        log_id      text PRIMARY KEY,
        source      text NOT NULL DEFAULT 'flight_review',
        payload     jsonb NOT NULL,
        status      text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','done','failed','missing')),
        attempts    int NOT NULL DEFAULT 0,
        last_error  text,
        worker      text,
        claimed_at  timestamptz,
        finished_at timestamptz,
        rows_loaded bigint,
        elapsed_s   double precision,
        created_at  timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE INDEX ingest_job_claim ON ingest_job (status, created_at, log_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ingest_job")
