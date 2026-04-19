"""add parse jobs versioning feedback

Revision ID: c3f4a8b9e1d2
Revises: a1d2f16cb7c3
Create Date: 2026-04-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c3f4a8b9e1d2"
down_revision: Union[str, None] = "a1d2f16cb7c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "receipt_uploads",
        sa.Column("parsed_version", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "receipt_uploads",
        sa.Column("last_parsed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "receipt_parse_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_json", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("pipeline_version", sa.String(length=32), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_receipt_parse_jobs_bill_id"),
        "receipt_parse_jobs",
        ["bill_id"],
        unique=False,
    )
    op.create_index(
        "ix_receipt_parse_jobs_bill_idempotency",
        "receipt_parse_jobs",
        ["bill_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    op.create_table(
        "receipt_item_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column("corrected_name", sa.String(length=255), nullable=True),
        sa.Column("original_quantity", sa.Integer(), nullable=True),
        sa.Column("corrected_quantity", sa.Integer(), nullable=True),
        sa.Column("original_unit_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("corrected_unit_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("original_total_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("corrected_total_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receipt_item_id"], ["receipt_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_receipt_item_feedback_bill_id"),
        "receipt_item_feedback",
        ["bill_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_receipt_item_feedback_receipt_item_id"),
        "receipt_item_feedback",
        ["receipt_item_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_receipt_item_feedback_receipt_item_id"),
        table_name="receipt_item_feedback",
    )
    op.drop_index(op.f("ix_receipt_item_feedback_bill_id"), table_name="receipt_item_feedback")
    op.drop_table("receipt_item_feedback")

    op.drop_index("ix_receipt_parse_jobs_bill_idempotency", table_name="receipt_parse_jobs")
    op.drop_index(op.f("ix_receipt_parse_jobs_bill_id"), table_name="receipt_parse_jobs")
    op.drop_table("receipt_parse_jobs")

    op.drop_column("receipt_uploads", "last_parsed_at")
    op.drop_column("receipt_uploads", "parsed_version")
