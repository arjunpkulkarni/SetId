"""add_receipt_structured_ocr_json

Revision ID: 6c1dfec92a21
Revises: 90c6154fafc1
Create Date: 2026-04-18 10:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6c1dfec92a21"
down_revision: Union[str, None] = "90c6154fafc1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("receipt_uploads", sa.Column("ocr_structured_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipt_uploads", "ocr_structured_json")
