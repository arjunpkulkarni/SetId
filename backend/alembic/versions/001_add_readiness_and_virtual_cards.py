"""Add bill readiness fields and virtual_cards table

Revision ID: 001_readiness_vcards
Revises:
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_readiness_vcards"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Bill readiness columns
    op.add_column("bills", sa.Column("ready_to_pay", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("bills", sa.Column("ready_marked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bills", sa.Column("ready_marked_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("bills", sa.Column("ready_reason", sa.String(50), nullable=True))
    op.create_foreign_key(
        "fk_bills_ready_marked_by_users",
        "bills",
        "users",
        ["ready_marked_by"],
        ["id"],
    )

    # Virtual cards table
    op.create_table(
        "virtual_cards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bills.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("stripe_card_id", sa.String(255), unique=True, nullable=True),
        sa.Column("stripe_cardholder_id", sa.String(255), nullable=True),
        sa.Column("card_number", sa.String(255), nullable=True),
        sa.Column("exp_month", sa.Integer(), nullable=True),
        sa.Column("exp_year", sa.Integer(), nullable=True),
        sa.Column("cvc", sa.String(10), nullable=True),
        sa.Column("spending_limit_cents", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(3), server_default="USD", nullable=False),
        sa.Column("status", sa.String(50), server_default="pending", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=True, index=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("virtual_cards")
    op.drop_constraint("fk_bills_ready_marked_by_users", "bills", type_="foreignkey")
    op.drop_column("bills", "ready_reason")
    op.drop_column("bills", "ready_marked_by")
    op.drop_column("bills", "ready_marked_at")
    op.drop_column("bills", "ready_to_pay")
