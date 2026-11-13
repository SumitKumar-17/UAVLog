"""cached flight investigations (cited reports) and saved workbench queries

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE investigation (
        flight_id  uuid PRIMARY KEY REFERENCES flight(id) ON DELETE CASCADE,
        model      text NOT NULL,
        evidence   jsonb NOT NULL,
        report     jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("""
    CREATE TABLE saved_query (
        id         bigserial PRIMARY KEY,
        title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
        sql        text NOT NULL CHECK (length(sql) BETWEEN 1 AND 4000),
        created_at timestamptz NOT NULL DEFAULT now()
    )""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS saved_query")
    op.execute("DROP TABLE IF EXISTS investigation")
