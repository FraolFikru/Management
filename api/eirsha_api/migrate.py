"""Schema additions made after the first release, applied at every start.

Each step checks before it changes anything, so restarts are safe and a fresh
database (db_init) and a live one end up identical.

  M1  Table service (the Waiter app)
      dining_table            the floor: one row per table in a branch
      customer_order          + table_id, waiter_id, bill_requested_at, note
      order_line              + served_at
      role WAITER             pos.sell, kds.view, hr.attendance_self
"""
from __future__ import annotations

import logging

from .db import Db

log = logging.getLogger("eirsha.migrate")


def _columns(db: Db, table: str) -> set[str]:
    if db.dialect == "postgres":
        return {r["column_name"] for r in db.all(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'eirsha' AND table_name = ?", (table,))}
    return {r[1] for r in db.conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(db: Db, table: str, column: str, pg_type: str, sqlite_type: str) -> None:
    if column not in _columns(db, table):
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {pg_type if db.dialect == 'postgres' else sqlite_type}")


def table_service(db: Db) -> None:
    pg = db.dialect == "postgres"
    db.execute(f"""CREATE TABLE IF NOT EXISTS dining_table (
        id         text PRIMARY KEY,
        org_id     text NOT NULL,
        branch_id  text NOT NULL,
        name       text NOT NULL,
        seats      integer NOT NULL DEFAULT 4,
        area       text,
        sort_order integer NOT NULL DEFAULT 0,
        is_active  {'boolean' if pg else 'INTEGER'} NOT NULL DEFAULT true,
        created_at {'timestamptz NOT NULL DEFAULT now()' if pg else "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"},
        FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
    )""")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_dining_table_name ON dining_table (branch_id, lower(name)) WHERE is_active")
    ts = "timestamptz" if pg else "TEXT"
    _add_column(db, "customer_order", "table_id", "text REFERENCES dining_table(id)", "text REFERENCES dining_table(id)")
    _add_column(db, "customer_order", "waiter_id", "text REFERENCES app_user(id)", "text REFERENCES app_user(id)")
    _add_column(db, "customer_order", "bill_requested_at", ts, ts)
    _add_column(db, "customer_order", "note", "text", "text")
    _add_column(db, "order_line", "served_at", ts, ts)
    # one open check per table
    db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS ux_order_table_open ON customer_order (table_id)
                  WHERE table_id IS NOT NULL AND status IN ('OPEN','SENT')""")
    db.execute("CREATE INDEX IF NOT EXISTS ix_order_waiter_open ON customer_order (waiter_id) WHERE status IN ('OPEN','SENT')")

    if not db.scalar("SELECT 1 FROM role WHERE code = 'WAITER'"):
        db.execute("INSERT INTO role (code, name_key, scope, is_system, sort_order) VALUES ('WAITER', 'role.WAITER', 'BRANCH', true, 3)")
    for lang, text in (("en", "Waiter"), ("am", "አስተናጋጅ"), ("om", "Keessummeessaa")):
        if not db.scalar("SELECT 1 FROM i18n_text WHERE key = 'role.WAITER' AND lang = ? AND org_id IS NULL", (lang,)):
            db.execute("INSERT INTO i18n_text (id, key, lang, text) VALUES (?, 'role.WAITER', ?, ?)", (f"i18n-role-waiter-{lang}", lang, text))
    for org in db.all("SELECT id FROM organization"):
        for perm in ("pos.sell", "kds.view", "hr.attendance_self"):
            if not db.scalar("SELECT 1 FROM role_permission WHERE org_id = ? AND role_code = 'WAITER' AND permission_code = ?", (org["id"], perm)):
                db.execute("INSERT INTO role_permission (org_id, role_code, permission_code) VALUES (?, 'WAITER', ?)", (org["id"], perm))


def migrate() -> None:
    db = Db.from_env()
    try:
        with db.tx():
            table_service(db)
    except Exception:
        log.exception("eirsha: migration failed")
        raise
    finally:
        db.conn.close()
