"""signal windows: 10 second windows of every flight embedded by how the signals behaved, for 'find similar moments'

Revision ID: 0008
Revises: 0007

The HNSW index is created by scripts/build_windows.py after the bulk load (building it on the filled table is much faster).
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE signal_window (
        flight_id uuid NOT NULL REFERENCES flight(id) ON DELETE CASCADE,
        t0        real NOT NULL,
        t1        real NOT NULL,
        embedding vector(32) NOT NULL,
        PRIMARY KEY (flight_id, t0)
    )""")
    op.execute("CREATE TABLE window_model (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), model jsonb NOT NULL, fitted_at timestamptz NOT NULL DEFAULT now())")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS window_model")
    op.execute("DROP TABLE IF EXISTS signal_window")
