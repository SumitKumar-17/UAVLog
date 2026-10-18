"""enable columnstore on telemetry (segment by series, order by time)

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One segment = one signal of one flight, ordered by time: matches the dominant access path
    # (a single flight's single signal over a time range) and compresses well (smooth series).
    op.execute("""
    ALTER TABLE telemetry SET (
        timescaledb.enable_columnstore = true,
        timescaledb.segmentby = 'flight_id, vendor_field_id',
        timescaledb.orderby = 'ts'
    )""")


def downgrade() -> None:
    op.execute("ALTER TABLE telemetry SET (timescaledb.enable_columnstore = false)")
