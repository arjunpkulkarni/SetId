"""merge_heads

Revision ID: 90c6154fafc1
Revises: bc332f71df41, d0cf49f69bb1
Create Date: 2026-04-13 16:22:54.166407

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '90c6154fafc1'
down_revision: Union[str, None] = ('bc332f71df41', 'd0cf49f69bb1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
