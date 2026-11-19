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
  M5  Restock requests (Manager → Purchases team)
      restock_request         one row per item the manager asks for
      purchase                + restock_request_id (the purchase that filled it)
  M6  Dispatch requests sent from the Purchases app
      dispatch_request        + client_ref (a retried send is saved once)
  M7  Dispatch requests come only from people allowed to send them
      a waiting request whose sender lacks dispatch.request is cancelled;
      the demo data's requests (made by sales staff) move to the demo
      branch's Purchases clerks
  M8  Lower restock minimums (reorder points) on items still at the old
      demo values; values someone changed are left alone
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
    # Sales Staff run the till: call them what they are.
    for lang, old, new in (("en", "Sales Staff", "Cashier"), ("am", "የሽያጭ ሰራተኛ", "ገንዘብ ተቀባይ"), ("om", "Hojjetaa Gurgurtaa", "Kaffaltii fudhataa")):
        db.execute("UPDATE i18n_text SET text = ? WHERE key = 'role.SALES_STAFF' AND lang = ? AND text = ?", (new, lang, old))
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


def owner_planning(db: Db) -> None:
    """Owner app: investment plans (Investments tab) and the targets on the Goals tab."""
    pg = db.dialect == "postgres"
    ts = "timestamptz NOT NULL DEFAULT now()" if pg else "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    money = "numeric(14,2)" if pg else "NUMERIC"
    db.execute(f"""CREATE TABLE IF NOT EXISTS owner_investment (
        id            text PRIMARY KEY,
        org_id        text NOT NULL REFERENCES organization(id),
        title         text NOT NULL,
        kind          text NOT NULL DEFAULT 'OTHER',
        target_amount {money} NOT NULL DEFAULT 0,
        saved_amount  {money} NOT NULL DEFAULT 0,
        target_date   {'date' if pg else 'TEXT'},
        note          text,
        created_by    text REFERENCES app_user(id),
        created_at    {ts},
        updated_at    {ts},
        deleted_at    {'timestamptz' if pg else 'TEXT'}
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS ix_owner_investment_org ON owner_investment (org_id) WHERE deleted_at IS NULL")
    db.execute(f"""CREATE TABLE IF NOT EXISTS owner_goal_target (
        org_id     text NOT NULL REFERENCES organization(id),
        goal_key   text NOT NULL,
        target     {money} NOT NULL,
        updated_by text REFERENCES app_user(id),
        updated_at {ts},
        PRIMARY KEY (org_id, goal_key)
    )""")


def restock_requests(db: Db) -> None:
    pg = db.dialect == "postgres"
    ts = "timestamptz" if pg else "TEXT"
    now = "timestamptz NOT NULL DEFAULT now()" if pg else "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    qty = "numeric(14,3)" if pg else "NUMERIC"
    db.execute(f"""CREATE TABLE IF NOT EXISTS restock_request (
        id              text PRIMARY KEY,
        org_id          text NOT NULL REFERENCES organization(id),
        branch_id       text NOT NULL,
        batch_id        text,
        item_id         text NOT NULL REFERENCES inventory_item(id),
        quantity        {qty} NOT NULL,
        unit_code       text NOT NULL,
        note            text,
        status          text NOT NULL DEFAULT 'OPEN',
        bought_quantity {qty} NOT NULL DEFAULT 0,
        requested_by    text NOT NULL REFERENCES app_user(id),
        requested_at    {now},
        handled_by      text REFERENCES app_user(id),
        handled_at      {ts},
        reason          text,
        done_at         {ts}
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS ix_restock_branch_status ON restock_request (branch_id, status)")
    _add_column(db, "purchase", "restock_request_id", "text REFERENCES restock_request(id)", "text REFERENCES restock_request(id)")


def dispatch_client_ref(db: Db) -> None:
    _add_column(db, "dispatch_request", "client_ref", "text", "text")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_client_ref ON dispatch_request (org_id, client_ref) WHERE client_ref IS NOT NULL")


def dispatch_senders(db: Db) -> None:
    # the demo data: Bole's sales staff "sent" dispatches; the Purchases clerks do that
    for old, new in (("U-014", "U-005"), ("U-015", "U-011"), ("U-016", "U-005")):
        db.execute("""UPDATE dispatch_request SET requested_by = ?
                      WHERE org_id = 'STORE-01' AND branch_id = 'BR-BOLE' AND requested_by = ?
                        AND EXISTS (SELECT 1 FROM app_user WHERE id = ? AND role_code = 'SALES_STAFF')
                        AND EXISTS (SELECT 1 FROM app_user WHERE id = ? AND role_code = 'INVENTORY_CLERK')""", (new, old, old, new))
    db.execute("""UPDATE dispatch_request SET status = 'CANCELLED'
                  WHERE status = 'PENDING' AND NOT EXISTS (
                    SELECT 1 FROM app_user u JOIN role_permission rp ON rp.org_id = u.org_id AND rp.role_code = u.role_code
                    WHERE u.id = dispatch_request.requested_by AND rp.permission_code = 'dispatch.request')""")


# item: (old demo minimum, new minimum). The old ones came from a price rule (cheap items 60, e.g. 60 kg of tomato).
RESTOCK_MINIMUMS = {
    "ayib": (8, 2),
    "bags": (20, 2),
    "beef": (4, 3),
    "beer": (4, 2),
    "berbere": (8, 2),
    "cabbage": (60, 10),
    "chicken": (8, 2),
    "coffee": (8, 2),
    "collard": (60, 5),
    "cups-lids": (8, 2),
    "cutlery": (20, 2),
    "degreaser": (8, 1),
    "detergent": (20, 2),
    "dish-soap": (20, 2),
    "eggs": (60, 30),
    "fish": (8, 2),
    "foil-roll": (8, 1),
    "foil-sheets": (8, 1),
    "food-lube": (8, 1),
    "food-sanitizer": (8, 1),
    "garlic": (20, 2),
    "ginger": (20, 2),
    "green-pepper": (20, 3),
    "ice": (20, 3),
    "injera": (60, 20),
    "kibbeh": (4, 1),
    "korerima": (4, 0.5),
    "lamb": (4, 2),
    "lentils": (20, 3),
    "milk": (20, 5),
    "mitmita": (4, 1),
    "mops": (8, 2),
    "napkins": (20, 3),
    "oil": (8, 1),
    "olive-oil": (4, 1),
    "onion": (20, 10),
    "paper-towels": (20, 3),
    "parchment": (20, 1),
    "plastic-wrap": (8, 1),
    "potato": (60, 10),
    "rice": (20, 3),
    "salt": (60, 2),
    "shiro": (20, 3),
    "soft-drinks": (4, 2),
    "straws": (20, 2),
    "surface-sanitizer": (20, 1),
    "syrup": (8, 1),
    "takeout-box": (8, 2),
    "tea": (8, 1),
    "teff": (20, 5),
    "tej": (20, 5),
    "tomato": (60, 10),
    "trash-liners": (20, 2),
    "water": (8, 2),
    "wheat-flour": (20, 5),
    "wine": (8, 3),
    "wrappers": (20, 2),
}


def lower_minimums(db: Db) -> None:
    for item, (old, new) in RESTOCK_MINIMUMS.items():
        db.execute("UPDATE branch_stock SET reorder_point = ? WHERE item_id = ? AND reorder_point = ?", (new, item, old))


def migrate() -> None:
    db = Db.from_env()
    try:
        with db.tx():
            table_service(db)
            rebrand(db)
            owner_chain(db)
            owner_planning(db)
            restock_requests(db)
            dispatch_client_ref(db)
            dispatch_senders(db)
            lower_minimums(db)
    except Exception:
        log.exception("seer: migration failed")
        raise
    finally:
        db.conn.close()
