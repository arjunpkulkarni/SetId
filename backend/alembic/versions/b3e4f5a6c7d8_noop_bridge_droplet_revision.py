"""noop bridge: production DBs were stamped with this id (not in repo).

Revision ID: b3e4f5a6c7d8
Revises: 2f4b6c8d9e10
Create Date: 2026-05-03

Some deploys had alembic_version set to b3e4f5a6c7d8 without a matching
file. This empty revision restores a linear history so `alembic upgrade head`
works without manual SQL.
"""

from typing import Sequence, Union

revision: str = "b3e4f5a6c7d8"
down_revision: Union[str, None] = "2f4b6c8d9e10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
