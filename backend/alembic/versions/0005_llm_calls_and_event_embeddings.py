"""LLM call log and event embeddings (index is built after bulk load, see scripts/build_vector_index.py)

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE llm_call (
        id                bigserial PRIMARY KEY,
        ts                timestamptz NOT NULL DEFAULT now(),
        kind              text NOT NULL,
        model             text NOT NULL,
        prompt_tokens     int NOT NULL DEFAULT 0,
        completion_tokens int NOT NULL DEFAULT 0,
        latency_ms        int,
        n_items           int NOT NULL DEFAULT 1
    )""")
    op.execute("ALTER TABLE event ADD COLUMN embedding vector(1536)")
    op.execute("ALTER TABLE event ADD COLUMN embedding_model text")


def downgrade() -> None:
    op.execute("ALTER TABLE event DROP COLUMN IF EXISTS embedding_model")
    op.execute("ALTER TABLE event DROP COLUMN IF EXISTS embedding")
    op.execute("DROP TABLE IF EXISTS llm_call")
