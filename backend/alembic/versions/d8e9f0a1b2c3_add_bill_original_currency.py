"""add bills.original_currency / original_total / fx_rate_to_usd

Stores a snapshot of the receipt's NATIVE currency + amount when the
receipt was parsed in something other than USD, so the BillSplit screen
can render a "≈ Rp 500,000" hint under the USD total. The host's payout
account stays USD — these columns are display-only and do NOT change
the math anywhere; the existing `subtotal` / `tax` / `total` etc. are
already converted to USD by the receipt parser before persistence.

`fx_rate_to_usd` is the rate USED at parse time (multiply original amount
by this to get USD; or divide USD by it to recover an approximate
original). Stored for auditability — if the rate changes the next day,
the host's bill numbers don't shift retroactively.

Revision ID: d8e9f0a1b2c3
Revises: c5d6e7f8a9b0
Create Date: 2026-05-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column("original_currency", sa.String(length=3), nullable=True),
    )
    op.add_column(
        "bills",
        sa.Column(
            "original_total",
            sa.Numeric(precision=14, scale=2),
            nullable=True,
        ),
    )
    # 8 decimal places is enough to capture currency rates with very
    # different magnitudes (e.g. 1 USD = 0.00006 BHD vs. 1 USD = 24,000
    # VND) without precision loss, while staying well inside Postgres'
    # numeric column limits.
    op.add_column(
        "bills",
        sa.Column(
            "fx_rate_to_usd",
            sa.Numeric(precision=18, scale=8),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("bills", "fx_rate_to_usd")
    op.drop_column("bills", "original_total")
    op.drop_column("bills", "original_currency")
