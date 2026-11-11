"""trigram indexes for listing text search

Revision ID: 6fff511c4c0a
Revises: d0f86b608d7f
Create Date: 2026-11-11 15:34:04.965918

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6fff511c4c0a'
down_revision: Union[str, Sequence[str], None] = 'd0f86b608d7f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # pg_trgm ships with PostgreSQL (contrib); managed services (RDS, Cloud SQL, Azure) allow it.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index("ix_listings_title_trgm", "listings", ["title"], postgresql_using="gin",
                    postgresql_ops={"title": "gin_trgm_ops"})
    op.create_index("ix_listings_description_trgm", "listings", ["description"], postgresql_using="gin",
                    postgresql_ops={"description": "gin_trgm_ops"})


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_listings_description_trgm", table_name="listings")
    op.drop_index("ix_listings_title_trgm", table_name="listings")
    # The extension is left installed: other objects may depend on it.
