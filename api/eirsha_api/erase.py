"""One-time "start from scratch": erase the demo history and the demo staff.

Runs at startup when the Render variable EIRSHA_ERASE_DEMO_KEEP is set to the
username of the one account to keep (e.g. selam.g). It runs once: afterwards an
audit entry `system.erase_demo` is left behind and later restarts skip it, so
the variable can stay until it is removed.

Kept: the organisation, branches, menu and prices, stock item list (levels
reset to 0), suppliers, money accounts (opening balances reset to 0), and all
reference lists (roles, permissions, units, categories, taxes, shifts,
translations). Everything else is removed.
"""
from __future__ import annotations

import logging
import os

from .db import Db, now_iso

log = logging.getLogger("eirsha.erase")

# Children before parents, so foreign keys are never left dangling.
HISTORY = [
    "kds_ticket_item", "kds_ticket", "order_line_modifier", "order_payment", "stock_movement", "order_line", "customer_order",
    "till_session", "daily_sales_payment", "daily_sales_summary", "cash_reconciliation", "cash_movement",
    "bill_payment", "bill_line", "bill", "purchase", "waste_report", "dispatch_request", "expense",
    "payslip", "payroll_run", "tax_filing", "budget_line", "attendance_break", "attendance_record", "schedule_entry",
    "performance_log", "outbox_event", "idempotency_key",
]


def _user_fks(db: Db) -> list[tuple[str, str]]:
    """Every (table, column) that points at app_user."""
    if db.dialect == "postgres":
        rows = db.all("""SELECT kcu.table_name AS tbl, kcu.column_name AS col
                         FROM information_schema.referential_constraints rc
                         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
                         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name AND ccu.constraint_schema = rc.unique_constraint_schema
                         WHERE ccu.table_name = 'app_user' AND kcu.constraint_schema = 'eirsha'""")
        return [(r["tbl"], r["col"]) for r in rows]
    out = []
    for (t,) in db.conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'").fetchall():
        for fk in db.conn.execute(f"PRAGMA foreign_key_list({t})").fetchall():
            if fk[2] == "app_user":
                out.append((t, fk[3]))
    return out


def erase_demo(db: Db, keep_username: str) -> dict:
    keep = db.one("SELECT id, org_id FROM app_user WHERE lower(username) = lower(?)", (keep_username,))
    if not keep:
        raise ValueError(f"no account with username {keep_username!r}: nothing erased")
    kid = keep["id"]
    counts = {}
    with db.tx():
        for t in HISTORY:
            counts[t] = db.execute(f"DELETE FROM {t}").rowcount
        # the audit trail is append-only: TRUNCATE (postgres) skips the row trigger; sqlite drops and re-adds it
        if db.dialect == "postgres":
            db.execute("TRUNCATE audit_log")
        else:
            db.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_delete")
            db.execute("DELETE FROM audit_log")
            db.execute("CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END")
        # stock levels and money start at zero
        db.execute("UPDATE branch_stock SET on_hand = 0, avg_unit_cost = NULL, last_unit_cost = NULL")
        db.execute("UPDATE money_account SET opening_balance = 0, opened_on = ?", (now_iso()[:10],))
        # staff: only the kept account stays; what the others created now points at it
        for t, c in _user_fks(db):
            if t in HISTORY or t in ("audit_log", "app_user", "auth_session", "user_branch_role", "employee"):
                continue
            db.execute(f"UPDATE {t} SET {c} = ? WHERE {c} IS NOT NULL AND {c} <> ?", (kid, kid))
        for t, c in _user_fks(db):
            if t == "app_user":                     # e.g. who created the kept account
                db.execute(f"UPDATE app_user SET {c} = NULL WHERE id = ?", (kid,))
        counts["auth_session"] = db.execute("DELETE FROM auth_session WHERE user_id <> ?", (kid,)).rowcount
        counts["user_branch_role"] = db.execute("DELETE FROM user_branch_role WHERE user_id <> ?", (kid,)).rowcount
        counts["employee"] = db.execute("DELETE FROM employee WHERE user_id <> ?", (kid,)).rowcount
        counts["app_user"] = db.execute("DELETE FROM app_user WHERE id <> ?", (kid,)).rowcount
        db.insert("audit_log", {"org_id": keep["org_id"], "module": "SYSTEM", "action": "system.erase_demo",
                                "entity_type": "organization", "entity_id": keep["org_id"], "actor_user_id": kid,
                                "summary_template": "Demo data erased; started from scratch", "vars": "{}"})
    return counts


def erase_if_requested() -> None:
    keep = os.environ.get("EIRSHA_ERASE_DEMO_KEEP", "").strip()
    if not keep:
        return
    db = Db.from_env()
    try:
        if db.scalar("SELECT 1 FROM audit_log WHERE action = 'system.erase_demo'"):
            log.warning("eirsha: demo data was already erased; remove EIRSHA_ERASE_DEMO_KEEP")
            return
        counts = erase_demo(db, keep)
        log.warning("eirsha: demo data erased, kept account %s: %s", keep, {k: v for k, v in counts.items() if v})
    except Exception:
        log.exception("eirsha: erasing the demo data failed; nothing was changed")
    finally:
        db.conn.close()
