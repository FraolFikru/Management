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
  M10 Kitchen "Ingredients used" log
      dish_ingredient_usage   expected vs actual per ticket dish and stock item
  M11 New stock item list for the Purchases team (catalogue.py)
  M12 Starter recipes for the demo menu (dishes with no recipe yet)
"""
from __future__ import annotations

import logging

from .db import Db, now_iso

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


def owner_changes(db: Db) -> None:
    pg = db.dialect == "postgres"
    ts = "timestamptz" if pg else "TEXT"
    db.execute(f"""CREATE TABLE IF NOT EXISTS owner_change (
        id              text PRIMARY KEY,
        org_id          text NOT NULL REFERENCES organization(id),
        kind            text NOT NULL,
        target_user_id  text REFERENCES app_user(id),
        payload         text,
        summary         text NOT NULL,
        requested_by    text NOT NULL REFERENCES app_user(id),
        requested_at    {ts} NOT NULL,
        status          text NOT NULL DEFAULT 'PENDING',
        wait_until      {ts},
        decided_by      text REFERENCES app_user(id),
        decided_at      {ts},
        reason          text
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS ix_owner_change_org_status ON owner_change (org_id, status)")


def dispatch_assignee(db: Db) -> None:
    _add_column(db, "dispatch_request", "assigned_to", "text REFERENCES app_user(id)", "text REFERENCES app_user(id)")


def kitchen_usage(db: Db) -> None:
    """M10 What the kitchen actually used for each dish (the "Ingredients used" step on the Kitchen screen).
    One row per ticket dish and stock item: expected (recipe × quantity) next to actual (what the cook entered)."""
    pg = db.dialect == "postgres"
    ts = "timestamptz NOT NULL DEFAULT now()" if pg else "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    db.execute(f"""CREATE TABLE IF NOT EXISTS dish_ingredient_usage (
        id                 text PRIMARY KEY,
        org_id             text NOT NULL,
        branch_id          text NOT NULL,
        ticket_id          text NOT NULL REFERENCES kds_ticket(id),
        ticket_item_id     text NOT NULL REFERENCES kds_ticket_item(id),
        order_id           text NOT NULL,
        order_number       text NOT NULL,
        menu_item_id       text,
        dish_name          text NOT NULL,
        inventory_item_id  text NOT NULL REFERENCES inventory_item(id),
        unit_code          text NOT NULL REFERENCES unit(code),
        expected_qty       numeric(14,3) NOT NULL DEFAULT 0,
        actual_qty         numeric(14,3) NOT NULL CHECK (actual_qty >= 0),
        stock_qty          numeric(14,3) NOT NULL DEFAULT 0,
        staff_id           text REFERENCES app_user(id),
        recorded_at        {ts},
        FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
    )""")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_dish_usage_line ON dish_ingredient_usage (ticket_item_id, inventory_item_id)")
    db.execute("CREATE INDEX IF NOT EXISTS ix_dish_usage_item ON dish_ingredient_usage (branch_id, inventory_item_id, recorded_at)")
    db.execute("CREATE INDEX IF NOT EXISTS ix_dish_usage_order ON dish_ingredient_usage (order_id)")


def _text(db: Db, key: str, lang: str, text: str) -> None:
    """Platform text (org_id NULL): insert, or update when it changed. Per-organisation overrides are left alone."""
    cur = db.one("SELECT id, text FROM i18n_text WHERE key = ? AND lang = ? AND org_id IS NULL", (key, lang))
    if not cur:
        db.execute("INSERT INTO i18n_text (id, key, lang, text) VALUES (?, ?, ?, ?)", (f"i18n-{key}-{lang}", key, lang, text))
    elif cur["text"] != text:
        db.execute("UPDATE i18n_text SET text = ? WHERE id = ?", (text, cur["id"]))


def ingredient_catalogue(db: Db) -> None:
    """M11 The Purchases team's new stock item list (catalogue.py). Items that keep their id keep their stock and
    history and only get the new name; new items are added with a small restock minimum at every branch; old food and
    drink items that are not on the list are hidden (deleted_at) but their records stay. Safe to repeat."""
    from . import catalogue as cat

    for g, (en, am, om) in cat.NEW_GROUPS.items():
        for lang, text in (("en", en), ("am", am), ("om", om)):
            _text(db, f"group.{g}", lang, text)
    for org in db.all("SELECT id FROM organization"):
        oid = org["id"]
        branches = [b["id"] for b in db.all("SELECT id FROM branch WHERE org_id = ? AND deleted_at IS NULL", (oid,))]
        for r in cat.rows():
            main = cat.GROUP_MAIN[r["group"]]
            key = f"inv.{r['id']}"
            cur = db.one("SELECT org_id, deleted_at FROM inventory_item WHERE id = ?", (r["id"],))
            if cur and cur["org_id"] != oid:
                continue                                   # the id belongs to another organisation
            if not cur:
                db.insert("inventory_item", {"id": r["id"], "org_id": oid, "name_key": key, "main_category_code": main,
                                             "group_key": f"group.{r['group']}", "unit_code": r["unit"],
                                             "standard_unit_cost": r["cost"], "is_custom": False})
                for b in branches:
                    if not db.scalar("SELECT 1 FROM branch_stock WHERE branch_id = ? AND item_id = ?", (b, r["id"])):
                        db.insert("branch_stock", {"org_id": oid, "branch_id": b, "item_id": r["id"], "on_hand": 0,
                                                   "reorder_point": r["minimum"]})
            elif cur["deleted_at"]:
                db.update("inventory_item", {"id": r["id"]}, {"deleted_at": None, "is_active": True})
            # group/main move with the list (e.g. avocado → Fruits); the unit of an item already in use stays
            db.execute("UPDATE inventory_item SET group_key = ?, main_category_code = ? WHERE id = ?",
                       (f"group.{r['group']}", main, r["id"]))
            for lang in ("en", "am", "om"):
                _text(db, key, lang, r[lang] or r["en"])
            for a in r["aliases"]:
                if not db.scalar("SELECT 1 FROM inventory_item_alias WHERE item_id = ? AND alias = ?", (r["id"], a)):
                    db.insert("inventory_item_alias", {"item_id": r["id"], "alias": a})
        for old in cat.RETIRED:
            db.execute("UPDATE inventory_item SET deleted_at = ?, is_active = ? WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
                       (now_iso(), False, old, oid))
            # recipes that pointed at a retired item: nothing on the new list replaces it, so the line is kept
            # (the kitchen can still record it) and reported once in the log for the owner to fix
            n = db.scalar("SELECT count(*) FROM recipe_component WHERE inventory_item_id = ?", (old,))
            if n:
                log.warning("seer: %s recipe line(s) still use the retired stock item %r; change them in the recipe", n, old)


def starter_recipes(db: Db) -> None:
    """M12 Starter recipes for the demo menu, only for dishes that have no recipe yet (catalogue.STARTER_RECIPES)."""
    from . import catalogue as cat

    for menu_id, comps in cat.STARTER_RECIPES.items():
        m = db.one("SELECT org_id FROM menu_item WHERE id = ?", (menu_id,))
        if not m or db.scalar("SELECT 1 FROM recipe_component WHERE menu_item_id = ?", (menu_id,)):
            continue
        for item_id, qty, unit in comps:
            if db.scalar("SELECT 1 FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (item_id, m["org_id"])):
                db.insert("recipe_component", {"menu_item_id": menu_id, "inventory_item_id": item_id, "quantity": qty, "unit_code": unit})


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
            owner_changes(db)
            dispatch_assignee(db)
            kitchen_usage(db)
            ingredient_catalogue(db)
            starter_recipes(db)
    except Exception:
        log.exception("seer: migration failed")
        raise
    finally:
        db.conn.close()
