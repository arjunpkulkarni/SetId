"""add expected_party_size to bills

Revision ID: 3a5b7c9d0e12
Revises: b3e4f5a6c7d8
Create Date: 2026-05-02 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "3a5b7c9d0e12"
down_revision: Union[str, None] = "b3e4f5a6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column("expected_party_size", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bills", "expected_party_size")
