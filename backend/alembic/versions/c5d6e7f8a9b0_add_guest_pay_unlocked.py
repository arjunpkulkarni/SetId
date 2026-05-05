"""add guest_pay_unlocked (host must allow guest checkout)

Revision ID: c5d6e7f8a9b0
Revises: b4c8d9e0f1a2
Create Date: 2026-05-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column(
            "guest_pay_unlocked",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )
    # Keep existing production bills behavior (guests could already pay).
    op.execute(sa.text("UPDATE bills SET guest_pay_unlocked = true"))
    op.alter_column("bills", "guest_pay_unlocked", server_default=None)


def downgrade() -> None:
    op.drop_column("bills", "guest_pay_unlocked")
