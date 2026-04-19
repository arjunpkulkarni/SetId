"""add_receipt_validation_fields

Revision ID: a1d2f16cb7c3
Revises: 6c1dfec92a21
Create Date: 2026-04-18 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1d2f16cb7c3"
down_revision: Union[str, None] = "6c1dfec92a21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("receipt_uploads", sa.Column("overall_confidence", sa.Float(), nullable=True))
    op.add_column("receipt_uploads", sa.Column("validation_warnings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipt_uploads", "validation_warnings")
    op.drop_column("receipt_uploads", "overall_confidence")
