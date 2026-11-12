"""Schema additions made after the first release, applied at every start.

Each step checks before it changes anything, so restarts are safe and a fresh
database (db_init) and a live one end up identical.

  M1  Table service (the Waiter app)
      dining_table            the floor: one row per table in a branch
      customer_order          + table_id, waiter_id, bill_requested_at, note
      order_line              + served_at
      role WAITER             pos.sell, kds.view, hr.attendance_self
  M2  SEER rebrand: stored text that still says "Bistro Addis"
  M3  Chain of trust: Owner → System Admin → everyone else
      the Owner app is the Owner's alone (owner.* removed from every other role)
      the Owner gets every System Admin permission too (the Owner is above the Admin)
      an organization with no Owner: its oldest active System Admin becomes the Owner
"""
from __future__ import annotations

import logging

from .db import Db

log = logging.getLogger("seer.migrate")


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


def rebrand(db: Db) -> None:
    """M2: the restaurant is SEER. Rename any stored text still carrying the demo name."""
    for table, col in (("organization", "legal_name"), ("organization", "trade_name"),
                       ("receipt_config", "header_message"), ("receipt_config", "footer_message"),
                       ("branch", "name")):
        if col in _columns(db, table):
            db.execute(f"UPDATE {table} SET {col} = REPLACE({col}, 'Bistro Addis', 'SEER') WHERE {col} LIKE '%Bistro Addis%'")
    for lang, old, new in (("en", "Admin", "System Admin"), ("am", "አስተዳዳሪ", "የሲስተም አስተዳዳሪ"), ("om", "Bulchiinsa", "Bulchaa sirnaa")):
        db.execute("UPDATE i18n_text SET text = ? WHERE key = 'role.ADMIN' AND lang = ? AND text = ?", (new, lang, old))
    if "email" in _columns(db, "app_user"):
        db.execute("UPDATE app_user SET email = REPLACE(email, '@bistroaddis.et', '@seer.et') WHERE email LIKE '%@bistroaddis.et'")
        db.execute("UPDATE app_user SET email = REPLACE(email, '@bistroaddis.com', '@seer.et') WHERE email LIKE '%@bistroaddis.com'")


def owner_chain(db: Db) -> None:
    db.execute("DELETE FROM role_permission WHERE role_code <> 'OWNER' AND permission_code LIKE 'owner.%'")
    for org in db.all("SELECT id FROM organization"):
        oid = org["id"]
        for r in db.all("SELECT permission_code FROM role_permission WHERE org_id = ? AND role_code = 'ADMIN'", (oid,)):
            if not db.scalar("SELECT 1 FROM role_permission WHERE org_id = ? AND role_code = 'OWNER' AND permission_code = ?",
                             (oid, r["permission_code"])):
                db.execute("INSERT INTO role_permission (org_id, role_code, permission_code) VALUES (?, 'OWNER', ?)", (oid, r["permission_code"]))
        if db.scalar("SELECT 1 FROM app_user WHERE org_id = ? AND role_code = 'OWNER' AND is_active AND deleted_at IS NULL", (oid,)):
            continue
        first = db.one("""SELECT id, username FROM app_user WHERE org_id = ? AND role_code = 'ADMIN' AND is_active AND deleted_at IS NULL
                          ORDER BY created_at, id LIMIT 1""", (oid,))
        if first:
            db.execute("UPDATE app_user SET role_code = 'OWNER' WHERE id = ?", (first["id"],))
            log.warning("seer: %s is now the Owner of %s (there was no Owner account)", first["username"], oid)


def migrate() -> None:
    db = Db.from_env()
    try:
        with db.tx():
            table_service(db)
            rebrand(db)
            owner_chain(db)
    except Exception:
        log.exception("seer: migration failed")
        raise
    finally:
        db.conn.close()
