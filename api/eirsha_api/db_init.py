"""First-start database setup, so a fresh hosted database needs no manual SQL.

On startup, if the `eirsha` schema does not exist yet, load:
  db/postgres/001_schema.sql, 002_views.sql, db/seed/postgres/010_reference.sql
and, when EIRSHA_LOAD_DEMO=true, also 020_demo.sql (demo history + demo logins).

For SQLite (EIRSHA_SQLITE) the same happens with the db/sqlite files.
Nothing runs when the schema is already there, so restarts are safe.
"""
from __future__ import annotations

import logging
import os

from .db import Db

log = logging.getLogger("eirsha.db_init")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def ensure_database() -> None:
    demo = os.environ.get("EIRSHA_LOAD_DEMO", "").lower() in ("1", "true", "yes")
    db = Db.from_env()
    try:
        if db.dialect == "postgres":
            if db.scalar("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'eirsha'"):
                return
            files = ["db/postgres/001_schema.sql", "db/postgres/002_views.sql", "db/seed/postgres/010_reference.sql"]
            if demo:
                files.append("db/seed/postgres/020_demo.sql")
            for f in files:
                log.warning("eirsha: loading %s", f)
                db.conn.execute(_read(f))          # no parameters → several statements per call are allowed
            db.conn.execute("SET search_path = eirsha, public")
        else:
            if db.scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organization'"):
                return
            files = ["db/sqlite/001_schema.sql", "db/sqlite/002_views.sql", "db/seed/sqlite/010_reference.sql"]
            if demo:
                files.append("db/seed/sqlite/020_demo.sql")
            for f in files:
                log.warning("eirsha: loading %s", f)
                db.conn.executescript(_read(f))
        log.warning("eirsha: database ready (demo data: %s)", demo)
    finally:
        db.conn.close()
