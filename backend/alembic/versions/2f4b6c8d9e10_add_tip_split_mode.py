"""add_tip_split_mode

Revision ID: 2f4b6c8d9e10
Revises: f1a2b3c4d5e6
Create Date: 2026-04-27 19:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2f4b6c8d9e10"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column(
            "tip_split_mode",
            sa.String(length=20),
            nullable=False,
            server_default="proportional",
        ),
    )
    op.alter_column("bills", "tip_split_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("bills", "tip_split_mode")
