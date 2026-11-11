"""arabic aware listing text search

Revision ID: 751cc70de6dd
Revises: 489892bcdcce
Create Date: 2026-11-11 16:24:29.063369

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '751cc70de6dd'
down_revision: Union[str, Sequence[str], None] = '489892bcdcce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Normalizes Arabic spelling variants so a search matches however the owner typed it:
# strips diacritics (tashkeel) and tatweel, unifies alef forms (أ إ آ ٱ -> ا), ى -> ي, ة -> ه,
# ؤ -> و, ئ -> ي, converts Arabic-Indic digits to ASCII, and lowercases Latin text.
NORM_FN = r"""
CREATE OR REPLACE FUNCTION darna_search_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(translate(regexp_replace(t, '[\u064B-\u065F\u0670\u0640]', '', 'g'),
                         'أإآٱىةؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'اااايهوي01234567890123456789'))
$$
"""

# Stemmed full-text document in both languages, so "apartment" finds "apartments" and
# "مفروشة" finds "مفروشه". Explicit regconfig casts keep it IMMUTABLE (indexable).
TSV_FN = r"""
CREATE OR REPLACE FUNCTION darna_listing_tsv(title text, description text) RETURNS tsvector
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsvector('english'::regconfig, darna_search_norm(coalesce(title, '') || ' ' || coalesce(description, '')))
      || to_tsvector('arabic'::regconfig, darna_search_norm(coalesce(title, '') || ' ' || coalesce(description, '')))
$$
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(NORM_FN)
    op.execute(TSV_FN)
    # Precomputed once per write (generated columns), so a search compares stored values instead of
    # re-normalizing every matching row; common terms match most listings and the planner then
    # scans rather than using an index.
    op.execute("ALTER TABLE listings ADD COLUMN search_text text GENERATED ALWAYS AS "
               "(darna_search_norm(coalesce(title, '') || ' ' || coalesce(description, ''))) STORED")
    op.execute("ALTER TABLE listings ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS "
               "(darna_listing_tsv(title, description)) STORED")
    op.drop_index("ix_listings_title_trgm", table_name="listings")
    op.drop_index("ix_listings_description_trgm", table_name="listings")
    op.execute("CREATE INDEX ix_listings_search_text_trgm ON listings USING gin (search_text gin_trgm_ops)")
    op.execute("CREATE INDEX ix_listings_search_fts ON listings USING gin (search_tsv)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_listings_search_fts", table_name="listings")
    op.drop_index("ix_listings_search_text_trgm", table_name="listings")
    op.drop_column("listings", "search_tsv")
    op.drop_column("listings", "search_text")
    op.execute("DROP FUNCTION darna_listing_tsv(text, text)")
    op.execute("DROP FUNCTION darna_search_norm(text)")
    op.create_index("ix_listings_title_trgm", "listings", ["title"], postgresql_using="gin",
                    postgresql_ops={"title": "gin_trgm_ops"})
    op.create_index("ix_listings_description_trgm", "listings", ["description"], postgresql_using="gin",
                    postgresql_ops={"description": "gin_trgm_ops"})
