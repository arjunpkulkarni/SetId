"""add_payment_link_token_column

Revision ID: 444df50207a1
Revises: 001_readiness_vcards
Create Date: 2026-04-13 14:49:56.636302

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '444df50207a1'
down_revision: Union[str, None] = '001_readiness_vcards'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add missing columns to payments table
    op.add_column('payments', sa.Column('payment_link_token', sa.String(64), nullable=True))
    op.add_column('payments', sa.Column('last_reminder_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('payments', sa.Column('payment_request_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_payments_payment_link_token', 'payments', ['payment_link_token'], unique=True)


def downgrade() -> None:
    # Remove added columns and index
    op.drop_index('ix_payments_payment_link_token', 'payments')
    op.drop_column('payments', 'payment_request_sent_at')
    op.drop_column('payments', 'last_reminder_sent_at')
    op.drop_column('payments', 'payment_link_token')
