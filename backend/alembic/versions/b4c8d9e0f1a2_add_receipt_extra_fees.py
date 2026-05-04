"""add receipt_extra_fees (venue surcharges from receipt OCR)

Revision ID: b4c8d9e0f1a2
Revises: 3a5b7c9d0e12
Create Date: 2026-05-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4c8d9e0f1a2"
down_revision: Union[str, None] = "3a5b7c9d0e12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column(
            "receipt_extra_fees",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            server_default="0",
        ),
    )
    op.alter_column("bills", "receipt_extra_fees", server_default=None)


def downgrade() -> None:
    op.drop_column("bills", "receipt_extra_fees")
