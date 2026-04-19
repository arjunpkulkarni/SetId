"""add_service_fee_type_and_percentage

Revision ID: d0cf49f69bb1
Revises: 444df50207a1
Create Date: 2026-04-13 16:22:40.152007

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd0cf49f69bb1'
down_revision: Union[str, None] = '444df50207a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bills', sa.Column('service_fee_type', sa.String(20), nullable=True))
    op.add_column('bills', sa.Column('service_fee_percentage', sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('bills', 'service_fee_percentage')
    op.drop_column('bills', 'service_fee_type')
