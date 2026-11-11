from logging.config import fileConfig

from sqlalchemy import create_engine

import app.models  # noqa: F401  (register models)
from alembic import context
from app.core.config import get_settings
from app.core.db import Base

config = context.config
if config.config_file_name is not None:
    # Keep application loggers enabled when migrations run in-process (e.g. the test harness).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # Text-search GIN indexes (pg_trgm opclass / expression indexes) live only in explicit migrations;
    # Alembic cannot compare them with model definitions and would report them as changed every time.
    if type_ == "index" and name and name.endswith(("_trgm", "_fts")):
        return False
    return True


def url() -> str:
    return config.attributes.get("database_url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(url=url(), target_metadata=target_metadata, literal_binds=True, compare_type=True,
                      include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                          include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
