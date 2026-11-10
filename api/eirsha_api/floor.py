"""Table service — the Waiter app's flows (also read by the Manager and Cashier screens).

A table is FREE until a waiter opens a check on it. The check (customer_order, DINE_IN)
belongs to that waiter; a manager can step in on any table. Items are saved to the check
either fired (a KDS ticket) or held for a later course. Payment is separate from ordering:
the waiter asks for the bill, the cashier takes the money (a waiter may take Telebirr /
CBE Birr at the table, never cash), and the table is free again once the check is paid.

Table status, most urgent first — worked out from the check, never stored:
  BILL        the bill was asked for
  READY       the kitchen has food waiting for this table
  IN_KITCHEN  items were fired and are being prepared
  SERVED      everything fired has reached the table
  SEATED      a check is open, nothing fired yet
  FREE        no open check

Every change writes a `floor` outbox event, so open screens refetch within a second.
"""
from __future__ import annotations

from typing import Any

from . import services as s
from .db import D, Db, money, new_id, now_iso
from .services import Actor, Conflict, Invalid, NotFound

MANAGE = "pos.void"            # managers / admins: may act on any waiter's table
SETUP = ("mgr.dashboard", "admin.branches_manage")
NO_CASH_ROLES = {"WAITER"}     # cash goes through the cashier


# ------------------------------------------------------------------ reading

def _line_state(ln: dict) -> str:
    if ln["status"] == "VOIDED":
        return "VOIDED"
    if not ln["ticket_status"]:
        return "HELD"
    if ln["served_at"] or ln["ticket_status"] == "BUMPED":
        return "SERVED"
    if ln["ticket_status"] == "READY" or ln["is_completed"]:
        return "READY"
    return "PREPARING" if ln["ticket_status"] == "PREPARING" else "SENT"


def _table_status(order: dict | None, states: list[str]) -> str:
    if not order:
        return "FREE"
    if order["bill_requested_at"]:
        return "BILL"
    live = [x for x in states if x != "VOIDED"]
    if "READY" in live:
        return "READY"
    if "SENT" in live or "PREPARING" in live:
        return "IN_KITCHEN"
    if "SERVED" in live:
        return "SERVED"
    return "SEATED"


_LINES = """SELECT l.*, t.status AS ticket_status, t.id AS ticket_id, i.is_completed
            FROM order_line l LEFT JOIN kds_ticket_item i ON i.order_line_id = l.id AND NOT i.is_voided
            LEFT JOIN kds_ticket t ON t.id = i.ticket_id"""


def floor(db: Db, actor: Actor, branch_id: str) -> dict:
    tables = db.all("SELECT * FROM dining_table WHERE branch_id = ? AND is_active ORDER BY sort_order, name", (branch_id,))
    orders = db.all("""SELECT o.*, u.full_name AS waiter_name FROM customer_order o LEFT JOIN app_user u ON u.id = o.waiter_id
                       WHERE o.branch_id = ? AND o.table_id IS NOT NULL AND o.status IN ('OPEN','SENT')""", (branch_id,))
    by_table = {o["table_id"]: o for o in orders}
    states: dict[str, list[str]] = {}
    for ln in db.all(_LINES + """ JOIN customer_order o ON o.id = l.order_id
                                  WHERE o.branch_id = ? AND o.table_id IS NOT NULL AND o.status IN ('OPEN','SENT')""", (branch_id,)):
        states.setdefault(ln["order_id"], []).append(_line_state(ln))
    paid = {r["order_id"]: D(r["amt"]) for r in db.all(
        """SELECT p.order_id, sum(p.amount) AS amt FROM order_payment p JOIN customer_order o ON o.id = p.order_id
           WHERE o.branch_id = ? AND o.status IN ('OPEN','SENT') AND p.status = 'CAPTURED' GROUP BY p.order_id""", (branch_id,))}
    out = []
    for t in tables:
        o = by_table.get(t["id"])
        st = states.get(o["id"], []) if o else []
        row: dict[str, Any] = {"id": t["id"], "name": t["name"], "seats": int(t["seats"]), "area": t["area"], "status": _table_status(o, st)}
        if o:
            row["order"] = {"id": o["id"], "orderNumber": o["order_number"], "guests": int(o["guest_count"] or 0),
                            "openedAt": s._iso(o["created_at"]), "total": float(money(o["total_gross"])),
                            "due": float(money(o["total_gross"]) - paid.get(o["id"], 0)),
                            "waiterId": o["waiter_id"], "waiterName": o["waiter_name"], "billRequestedAt": s._iso(o["bill_requested_at"]),
                            "ready": st.count("READY"), "held": st.count("HELD")}
        out.append(row)
    waiters = db.all("""SELECT DISTINCT u.id, u.full_name AS name, u.role_code AS role FROM app_user u
                        WHERE u.org_id = ? AND u.is_active AND u.deleted_at IS NULL AND u.role_code IN ('WAITER','SALES_STAFF','BRANCH_MANAGER')
                        AND (u.home_branch_id = ? OR EXISTS (SELECT 1 FROM user_branch_role r WHERE r.user_id = u.id AND r.branch_id = ?))
                        ORDER BY u.full_name""", (actor.org_id, branch_id, branch_id))
    return {"serverTime": now_iso(), "branch": {"id": branch_id, "name": db.scalar("SELECT name FROM branch WHERE id = ?", (branch_id,))},
            "tables": out, "waiters": waiters}


def order_view(db: Db, order_id: str) -> dict:
    o = db.one("""SELECT o.*, u.full_name AS waiter_name FROM customer_order o LEFT JOIN app_user u ON u.id = o.waiter_id
                  WHERE o.id = ?""", (order_id,))
    if not o:
        raise NotFound("order not found", id=order_id)
    mods: dict[str, list] = {}
    for m in db.all("""SELECT m.* FROM order_line_modifier m JOIN order_line l ON l.id = m.order_line_id WHERE l.order_id = ?""", (order_id,)):
        mods.setdefault(m["order_line_id"], []).append({"id": m["modifier_id"] or m["id"], "name": m["name"]})
    keys = {r["id"]: r["name_key"] for r in db.all(
        "SELECT mi.id, mi.name_key FROM menu_item mi JOIN order_line l ON l.menu_item_id = mi.id WHERE l.order_id = ?", (order_id,))}
    lines, states = [], []
    for ln in db.all(_LINES + " WHERE l.order_id = ? ORDER BY l.line_no", (order_id,)):
        st = _line_state(ln)
        states.append(st)
        lines.append({"id": ln["id"], "menuItemId": ln["menu_item_id"], "name": ln["item_name"], "nameKey": keys.get(ln["menu_item_id"]),
                      "quantity": float(D(ln["quantity"])), "unitPrice": float(money(ln["unit_price"])),
                      "total": float(money(ln["line_total"])), "course": int(ln["course"]), "note": ln["note"] or "",
                      "modifiers": mods.get(ln["id"], []), "state": st, "voidReason": ln["void_reason"]})
    pays = db.all("SELECT * FROM order_payment WHERE order_id = ? AND status = 'CAPTURED' ORDER BY received_at", (order_id,))
    paid = sum((money(p["amount"]) for p in pays), money(0))
    closed = o["status"] not in ("OPEN", "SENT")
    return {"id": o["id"], "orderNumber": o["order_number"], "tableId": o["table_id"], "tableName": o["table_number"],
            "guests": int(o["guest_count"] or 0), "waiterId": o["waiter_id"], "waiterName": o["waiter_name"],
            "openedAt": s._iso(o["created_at"]), "note": o["note"] or "", "billRequestedAt": s._iso(o["bill_requested_at"]),
            "orderStatus": o["status"], "status": o["status"] if closed else _table_status(o, states),
            "total": float(money(o["total_gross"])), "vat": float(money(o["vat_amount"])), "paid": float(paid),
            "due": float(money(o["total_gross"]) - paid), "receiptNo": o["receipt_no"], "lines": lines,
            "payments": [{"method": p["payment_method_code"], "amount": float(money(p["amount"])), "reference": p["reference"]} for p in pays]}


def menu(db: Db, actor: Actor, branch_id: str) -> dict:
    rows = db.all("""SELECT v.*, mi.is_fasting, mi.sort_order FROM v_branch_menu v JOIN menu_item mi ON mi.id = v.menu_item_id
                     WHERE v.branch_id = ? AND v.is_available ORDER BY mi.sort_order, v.menu_item_id""", (branch_id,))
    cats = db.all("SELECT * FROM menu_category ORDER BY sort_order")
    all_mods = db.all("SELECT * FROM modifier WHERE org_id = ? AND is_active", (actor.org_id,))
    per_item: dict[str, list[str]] = {}
    for r in db.all("SELECT mm.* FROM menu_item_modifier mm JOIN menu_item mi ON mi.id = mm.menu_item_id WHERE mi.org_id = ?", (actor.org_id,)):
        per_item.setdefault(r["menu_item_id"], []).append(r["modifier_id"])
    keys = {r["name_key"] for r in rows} | {c["name_key"] for c in cats} | {m["name_key"] for m in all_mods}
    text: dict[str, dict[str, str]] = {}
    for r in db.all("SELECT key, lang, text, org_id FROM i18n_text WHERE org_id IS NULL OR org_id = ? ORDER BY org_id IS NOT NULL", (actor.org_id,)):
        if r["key"] in keys:
            text.setdefault(r["key"], {})[r["lang"]] = r["text"]          # the organisation's own wording wins
    def names(key: str, fallback: str) -> dict:
        t = text.get(key, {})
        en = t.get("en") or fallback
        return {"en": en, "am": t.get("am") or en, "om": t.get("om") or en}
    used = {r["category_code"] for r in rows}
    return {"categories": [{"code": c["code"], "name": names(c["name_key"], c["code"].replace("_", " ").title())} for c in cats if c["code"] in used],
            "items": [{"id": r["menu_item_id"], "name": names(r["name_key"], r["menu_item_id"]), "category": r["category_code"],
                       "price": float(money(r["price"])), "fasting": bool(r["is_fasting"]), "beverage": r["revenue_class"] == "BEVERAGE",
                       **({"modifiers": per_item[r["menu_item_id"]]} if r["menu_item_id"] in per_item else {})} for r in rows],
            "modifiers": [{"id": m["id"], "name": names(m["name_key"], m["id"]), "priceDelta": float(D(m["price_delta"]))} for m in all_mods]}


# ------------------------------------------------------------------ writing

def _open(db: Db, actor: Actor, order_id: str, perms: frozenset[str], *, own: bool = True) -> dict:
    """The open check, after checking this person may change it."""
    o = s._get(db, "customer_order", order_id, actor.org_id)
    if o["status"] not in ("OPEN", "SENT"):
        raise Conflict("this check is already closed", status=o["status"])
    if own and o["waiter_id"] and o["waiter_id"] != actor.user_id and MANAGE not in perms:
        who = db.scalar("SELECT full_name FROM app_user WHERE id = ?", (o["waiter_id"],))
        raise Conflict(f"this table belongs to {who}; ask them to transfer it, or call a manager")
    return o


def open_table(db: Db, actor: Actor, branch_id: str, table_id: str, guests: int, order_id: str | None = None) -> dict:
    if order_id and db.scalar("SELECT 1 FROM customer_order WHERE id = ?", (order_id,)):
        return order_view(db, order_id)                     # a retried request
    t = db.one("SELECT * FROM dining_table WHERE id = ? AND branch_id = ? AND is_active", (table_id, branch_id))
    if not t:
        raise NotFound("table not found", id=table_id)
    if not 1 <= guests <= 60:
        raise Invalid("guests must be between 1 and 60")
    busy = db.one("""SELECT o.id, u.full_name FROM customer_order o LEFT JOIN app_user u ON u.id = o.waiter_id
                     WHERE o.table_id = ? AND o.status IN ('OPEN','SENT')""", (table_id,))
    if busy:
        raise Conflict(f"{t['name']} already has an open check ({busy['full_name'] or 'another waiter'})", orderId=busy["id"])
    from datetime import datetime, timezone
    bd = s.business_date()
    seq = int(db.scalar("SELECT count(*) FROM customer_order WHERE branch_id = ? AND business_date = ?", (branch_id, bd))) + 1
    oid = order_id or new_id("ord")
    db.insert("customer_order", {"id": oid, "org_id": actor.org_id, "branch_id": branch_id, "order_number": f"{seq:03d}", "business_date": bd,
                                 "shift_code": s._shift_for(db, actor.org_id, branch_id, datetime.now(timezone.utc)), "order_type": "DINE_IN",
                                 "table_number": t["name"], "table_id": table_id, "guest_count": guests, "opened_by": actor.user_id,
                                 "waiter_id": actor.user_id, "client_ref": oid})
    o = db.one("SELECT * FROM customer_order WHERE id = ?", (oid,))
    s.floor_event(db, actor.org_id, branch_id, "opened", o)
    s.audit(db, actor, "POS", "table.open", "customer_order", oid, "{table} opened for {guests} guests",
            {"table": t["name"], "guests": guests, "orderNumber": o["order_number"]}, branch_id=branch_id)
    return order_view(db, oid)


def add_items(db: Db, actor: Actor, perms: frozenset[str], order_id: str, lines: list[dict], fire: str | list[int] = "ALL") -> dict:
    """Save items to the check. fire = "ALL" | "NONE" | [course numbers]: what goes to the kitchen now; the rest is held."""
    o = _open(db, actor, order_id, perms)
    new_ids = [ln["id"] for ln in lines if ln.get("id") and not db.scalar("SELECT 1 FROM order_line WHERE id = ?", (ln["id"],))]
    s.add_lines(db, actor, order_id, lines)
    if o["bill_requested_at"]:                              # the guests ordered more: the bill is not ready after all
        db.update("customer_order", {"id": order_id}, {"bill_requested_at": None})
    fired = 0
    if fire != "NONE" and new_ids:
        rows = db.all("SELECT id, course FROM order_line WHERE order_id = ? AND status = 'ACTIVE'", (order_id,))
        ids = [r["id"] for r in rows if r["id"] in set(new_ids) and (fire == "ALL" or int(r["course"]) in fire)]
        if ids:
            s.send_to_kitchen(db, actor, order_id, line_ids=ids)
            fired = len(ids)
    if not fired:
        s.floor_event(db, actor.org_id, o["branch_id"], "items", o)
    return order_view(db, order_id)


def fire(db: Db, actor: Actor, perms: frozenset[str], order_id: str, course: int | None = None, line_ids: list[str] | None = None) -> dict:
    """Send held items to the kitchen: one course, chosen lines, or everything held."""
    _open(db, actor, order_id, perms)
    s.send_to_kitchen(db, actor, order_id, course=course, line_ids=line_ids)
    return order_view(db, order_id)


def remove_line(db: Db, actor: Actor, perms: frozenset[str], line_id: str, reason: str | None = None) -> dict:
    """A held item is simply taken off. An item the kitchen already has is voided, with a reason (logged for the manager)."""
    ln = db.one("SELECT l.*, o.org_id FROM order_line l JOIN customer_order o ON o.id = l.order_id WHERE l.id = ?", (line_id,))
    if not ln or ln["org_id"] != actor.org_id:
        raise NotFound("item not found")
    o = _open(db, actor, ln["order_id"], perms)
    if ln["status"] == "VOIDED":
        return order_view(db, ln["order_id"])
    if db.scalar("SELECT 1 FROM kds_ticket_item WHERE order_line_id = ?", (line_id,)):
        if not (reason or "").strip():
            raise Invalid("the kitchen already has this item: give a reason to void it")
        s.void_line(db, actor, line_id, reason.strip())
    else:
        db.execute("DELETE FROM order_line_modifier WHERE order_line_id = ?", (line_id,))
        db.execute("DELETE FROM order_line WHERE id = ?", (line_id,))
        s._recompute_totals(db, ln["order_id"])
    s.floor_event(db, actor.org_id, o["branch_id"], "items", o)
    return order_view(db, ln["order_id"])


def mark_served(db: Db, actor: Actor, perms: frozenset[str], order_id: str, line_ids: list[str] | None = None) -> dict:
    """The food reached the table. Ready tickets whose items are all served leave the kitchen board."""
    o = _open(db, actor, order_id, perms)
    rows = db.all(_LINES + " WHERE l.order_id = ? AND l.status = 'ACTIVE'", (order_id,))
    want = set(line_ids) if line_ids else None
    tickets = set()
    for ln in rows:
        if ln["ticket_id"] and not ln["served_at"] and (ln["id"] in want if want else _line_state(ln) == "READY"):
            db.update("order_line", {"id": ln["id"]}, {"served_at": now_iso()})
            tickets.add(ln["ticket_id"])
    for tid in tickets:
        t = db.one("SELECT status FROM kds_ticket WHERE id = ?", (tid,))
        left = db.scalar("""SELECT count(*) FROM kds_ticket_item i JOIN order_line l ON l.id = i.order_line_id
                            WHERE i.ticket_id = ? AND NOT i.is_voided AND l.served_at IS NULL""", (tid,))
        if t["status"] == "READY" and int(left) == 0:
            s.kds_command(db, actor, tid, "bump", {})
    s.floor_event(db, actor.org_id, o["branch_id"], "served", o)
    return order_view(db, order_id)


def request_bill(db: Db, actor: Actor, perms: frozenset[str], order_id: str, requested: bool = True) -> dict:
    o = _open(db, actor, order_id, perms)
    if requested and not db.scalar("SELECT 1 FROM order_line WHERE order_id = ? AND status = 'ACTIVE'", (order_id,)):
        raise Conflict("there is nothing on this check yet")
    if requested and db.scalar("""SELECT 1 FROM order_line l WHERE l.order_id = ? AND l.status = 'ACTIVE'
                                  AND NOT EXISTS (SELECT 1 FROM kds_ticket_item i WHERE i.order_line_id = l.id)""", (order_id,)):
        raise Conflict("some items are still held: send them or take them off before asking for the bill")
    db.update("customer_order", {"id": order_id}, {"bill_requested_at": now_iso() if requested else None})
    o = db.one("SELECT * FROM customer_order WHERE id = ?", (order_id,))
    s.floor_event(db, actor.org_id, o["branch_id"], "bill" if requested else "bill_cancelled", o)
    s.audit(db, actor, "POS", "table.bill_request" if requested else "table.bill_cancel", "customer_order", order_id,
            "{table}: bill requested" if requested else "{table}: bill request withdrawn",
            {"table": o["table_number"], "orderNumber": o["order_number"], "amount": str(o["total_gross"])}, branch_id=o["branch_id"])
    return order_view(db, order_id)


def update_check(db: Db, actor: Actor, perms: frozenset[str], order_id: str, guests: int | None = None, note: str | None = None) -> dict:
    o = _open(db, actor, order_id, perms)
    ch: dict[str, Any] = {}
    if guests is not None:
        if not 1 <= guests <= 60:
            raise Invalid("guests must be between 1 and 60")
        ch["guest_count"] = guests
    if note is not None:
        ch["note"] = note.strip()[:300] or None
    if ch:
        db.update("customer_order", {"id": order_id}, ch)
        s.floor_event(db, actor.org_id, o["branch_id"], "updated", o)
    return order_view(db, order_id)


def transfer(db: Db, actor: Actor, perms: frozenset[str], order_id: str, waiter_id: str | None = None, table_id: str | None = None) -> dict:
    """Hand the table to another waiter, or move the guests to a free table."""
    o = _open(db, actor, order_id, perms)
    ch: dict[str, Any] = {}
    if waiter_id and waiter_id != o["waiter_id"]:
        w = db.one("SELECT id, full_name FROM app_user WHERE id = ? AND org_id = ? AND is_active AND deleted_at IS NULL", (waiter_id, actor.org_id))
        if not w or not db.scalar("SELECT 1 FROM v_user_permission WHERE user_id = ? AND permission_code = 'pos.sell'", (waiter_id,)):
            raise Invalid("that person can't take tables")
        ch["waiter_id"] = waiter_id
    if table_id and table_id != o["table_id"]:
        t = db.one("SELECT * FROM dining_table WHERE id = ? AND branch_id = ? AND is_active", (table_id, o["branch_id"]))
        if not t:
            raise NotFound("table not found", id=table_id)
        if db.scalar("SELECT 1 FROM customer_order WHERE table_id = ? AND status IN ('OPEN','SENT')", (table_id,)):
            raise Conflict(f"{t['name']} is not free")
        ch.update(table_id=table_id, table_number=t["name"])
        for k in db.all("SELECT id FROM kds_ticket WHERE order_id = ? AND status IN ('PENDING','PREPARING','READY')", (order_id,)):
            db.update("kds_ticket", {"id": k["id"]}, {"table_number": t["name"]})
            s.outbox(db, actor.org_id, o["branch_id"], "kds.ticket", "upsert", "kds_ticket", k["id"], {"type": "upsert", "ticket": s.kds_payload(db, k["id"])})
    if not ch:
        return order_view(db, order_id)
    db.update("customer_order", {"id": order_id}, ch)
    s.floor_event(db, actor.org_id, o["branch_id"], "transferred", o)             # the old table…
    n = db.one("SELECT * FROM customer_order WHERE id = ?", (order_id,))
    s.floor_event(db, actor.org_id, o["branch_id"], "transferred", n)             # …and the new one / new waiter
    s.audit(db, actor, "POS", "table.transfer", "customer_order", order_id, "{table} handed over",
            {"table": n["table_number"], "fromTable": o["table_number"], "toWaiter": ch.get("waiter_id"), "orderNumber": o["order_number"]},
            branch_id=o["branch_id"])
    return order_view(db, order_id)


def pay(db: Db, actor: Actor, perms: frozenset[str], order_id: str, payments: list[dict]) -> dict:
    """Take money for a table. Anyone on the till can; a waiter only Telebirr / CBE Birr (cash goes to the cashier)."""
    o = _open(db, actor, order_id, perms, own=False)
    if actor.role in NO_CASH_ROLES and any(p["method"] == "CASH" for p in payments):
        raise Invalid("cash is paid at the cashier: request the bill instead")
    if actor.role in NO_CASH_ROLES and o["waiter_id"] != actor.user_id:
        raise Conflict("only this table's waiter or the cashier can take its payment")
    if db.scalar("""SELECT 1 FROM order_line l WHERE l.order_id = ? AND l.status = 'ACTIVE'
                    AND NOT EXISTS (SELECT 1 FROM kds_ticket_item i WHERE i.order_line_id = l.id)""", (order_id,)):
        raise Conflict("some items are still held: send them or take them off before payment")
    s.pay_order(db, actor, order_id, payments)
    return order_view(db, order_id)


def close_empty(db: Db, actor: Actor, perms: frozenset[str], order_id: str, reason: str | None = None) -> dict:
    """Free a table whose check has nothing left on it (opened by mistake, or the guests left before ordering)."""
    o = _open(db, actor, order_id, perms)
    if db.scalar("SELECT 1 FROM order_line WHERE order_id = ? AND status = 'ACTIVE'", (order_id,)):
        raise Conflict("this check still has items: take them off or void them first")
    if db.scalar("SELECT 1 FROM order_payment WHERE order_id = ? AND status = 'CAPTURED'", (order_id,)):
        raise Conflict("this check has a payment; ask a manager")
    db.update("customer_order", {"id": order_id}, {"status": "VOIDED", "voided_by": actor.user_id, "voided_at": now_iso(),
                                                   "void_reason": (reason or "").strip() or "Closed with nothing ordered"})
    s.floor_event(db, actor.org_id, o["branch_id"], "closed", o)
    s.audit(db, actor, "POS", "table.close_empty", "customer_order", order_id, "{table} closed with nothing ordered",
            {"table": o["table_number"], "orderNumber": o["order_number"]}, branch_id=o["branch_id"])
    return order_view(db, order_id)


# ------------------------------------------------------------------ setting up the floor (managers)

def add_tables(db: Db, actor: Actor, branch_id: str, names: list[str], seats: int = 4, area: str | None = None) -> list[dict]:
    n = int(db.scalar("SELECT coalesce(max(sort_order), 0) FROM dining_table WHERE branch_id = ?", (branch_id,)))
    made = []
    for name in names:
        name = name.strip()[:20]
        if not name:
            continue
        if db.scalar("SELECT 1 FROM dining_table WHERE branch_id = ? AND lower(name) = lower(CAST(? AS text)) AND is_active", (branch_id, name)):
            raise Conflict(f"there is already a table called {name}")
        n += 1
        row = {"id": new_id("tbl"), "org_id": actor.org_id, "branch_id": branch_id, "name": name, "seats": max(1, min(int(seats), 60)),
               "area": area, "sort_order": n}
        db.insert("dining_table", row)
        made.append(row)
    if made:
        s.outbox(db, actor.org_id, branch_id, "floor", "tables", "dining_table", made[0]["id"], {})
        s.audit(db, actor, "POS", "table.setup", "dining_table", made[0]["id"], "Added {count} tables", {"count": len(made)}, branch_id=branch_id)
    return made


def edit_table(db: Db, actor: Actor, table_id: str, name: str | None = None, seats: int | None = None, active: bool | None = None) -> dict:
    t = s._get(db, "dining_table", table_id, actor.org_id)
    ch: dict[str, Any] = {}
    if name is not None and name.strip() and name.strip() != t["name"]:
        if db.scalar("SELECT 1 FROM dining_table WHERE branch_id = ? AND lower(name) = lower(CAST(? AS text)) AND is_active AND id <> ?",
                     (t["branch_id"], name.strip(), table_id)):
            raise Conflict(f"there is already a table called {name.strip()}")
        ch["name"] = name.strip()[:20]
    if seats is not None:
        ch["seats"] = max(1, min(int(seats), 60))
    if active is False:
        if db.scalar("SELECT 1 FROM customer_order WHERE table_id = ? AND status IN ('OPEN','SENT')", (table_id,)):
            raise Conflict("this table has an open check")
        ch["is_active"] = False
    if ch:
        db.update("dining_table", {"id": table_id}, ch)
        s.outbox(db, actor.org_id, t["branch_id"], "floor", "tables", "dining_table", table_id, {})
    return db.one("SELECT * FROM dining_table WHERE id = ?", (table_id,))
