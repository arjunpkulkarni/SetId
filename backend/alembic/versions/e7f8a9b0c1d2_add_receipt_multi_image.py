"""add receipt multi-image columns

Revision ID: e7f8a9b0c1d2
Revises: c3f4a8b9e1d2
Create Date: 2026-04-18 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "c3f4a8b9e1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "receipt_uploads",
        sa.Column("receipt_images", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "receipt_uploads",
        sa.Column("is_multi_image", sa.Boolean(), server_default="false", nullable=False),
    )
    op.execute(
        """
        UPDATE receipt_uploads
        SET receipt_images = jsonb_build_array(
            jsonb_build_object(
                'file_path', file_path,
                'original_filename', original_filename,
                'content_type', content_type
            )
        )
        WHERE receipt_images IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("receipt_uploads", "is_multi_image")
    op.drop_column("receipt_uploads", "receipt_images")
