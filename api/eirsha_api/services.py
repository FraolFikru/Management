"""Cross-module business flows — the connection points between the seven frontends.

Every public function:
  * runs inside the caller's transaction (`with db.tx(): ...`),
  * validates state transitions the frontends already enforce locally,
  * writes the audit_log row and any outbox_event in the SAME transaction,
  * returns plain dicts in the shape the calling frontend already uses.

Flows
  POS  create_order → send_to_kitchen ─────────────► KDS kds_command(status/item/bump/recall)
       pay_order → close_day (Z-report) ───────────► FIN daily_sales_summary, cash_reconciliation
  SALES log_purchase → MGR review_purchase ────────► stock_movement + FIN bill/bill_line(/bill_payment)
  FIN  pay_bill (VAT + withholding 3 % / 30 %)
  SALES log_waste → MGR decide_waste ──────────────► stock out, P&L shrinkage
  SALES request_dispatch → MGR decide_dispatch ────► stock out / inter-branch transfer
  SALES/MGR log_expense ───────────────────────────► cash_movement, P&L
  HR   clock_in / clock_out → calculate_payroll → approve_payroll → pay_payroll ─► FIN cash + tax_filing
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from .db import D, Db, money, new_id, now_iso

ADDIS = timezone(timedelta(hours=3))
NORMAL_DAY_HOURS = Decimal(8)
MONTH_HOURS = Decimal(208)
LATE_GRACE_MIN = 5


# ------------------------------------------------------------------ errors & actor

class ServiceError(Exception):
    status = 400

    def __init__(self, message: str, **detail: Any) -> None:
        super().__init__(message)
        self.detail = detail


class NotFound(ServiceError):
    status = 404


class Conflict(ServiceError):
    status = 409


class Invalid(ServiceError):
    status = 422


class Forbidden(ServiceError):
    status = 403


@dataclass(frozen=True)
class Actor:
    """Who is acting: resolved from the JWT (person) or device + PIN."""
    user_id: str
    org_id: str
    role: str
    name: str
    branch_id: str | None = None
    device_id: str | None = None

    @classmethod
    def load(cls, db: Db, user_id: str, branch_id: str | None = None, device_id: str | None = None) -> "Actor":
        u = db.one("SELECT id, org_id, role_code, full_name, home_branch_id FROM app_user WHERE id = ? AND deleted_at IS NULL", (user_id,))
        if not u:
            raise NotFound("user not found", user_id=user_id)
        return cls(u["id"], u["org_id"], u["role_code"], u["full_name"], branch_id or u["home_branch_id"], device_id)


# ------------------------------------------------------------------ shared helpers

def _iso(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return str(v)


def _dt(v: Any) -> datetime:
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def business_date(at: str | None = None) -> str:
    return (_dt(at) if at else datetime.now(timezone.utc)).astimezone(ADDIS).date().isoformat()


def audit(db: Db, actor: Actor, module: str, action: str, entity_type: str, entity_id: str | None,
          template: str, vars: dict | None = None, before: dict | None = None, after: dict | None = None,
          branch_id: str | None = None) -> None:
    db.insert("audit_log", {
        "org_id": actor.org_id, "branch_id": branch_id or actor.branch_id, "occurred_at": now_iso(), "module": module,
        "action": action, "entity_type": entity_type, "entity_id": entity_id, "actor_user_id": actor.user_id,
        "actor_name": actor.name, "actor_role": actor.role, "device_id": actor.device_id,
        "summary_template": template, "vars": vars or {}, "before_data": before, "after_data": after})


def outbox(db: Db, org_id: str, branch_id: str | None, topic: str, event_type: str,
           aggregate_type: str, aggregate_id: str, payload: dict) -> None:
    db.insert("outbox_event", {"org_id": org_id, "branch_id": branch_id, "topic": topic, "event_type": event_type,
                               "aggregate_type": aggregate_type, "aggregate_id": aggregate_id, "payload": payload})


def _get(db: Db, table: str, id_: str, org_id: str, key: str = "id") -> dict:
    row = db.one(f"SELECT * FROM {table} WHERE {key} = ? AND org_id = ?", (id_, org_id))
    if not row:
        raise NotFound(f"{table} not found", id=id_)
    return row


def tax_rate(db: Db, org_id: str, code: str, on: str | None = None) -> tuple[Decimal, Decimal | None]:
    on = on or date.today().isoformat()
    r = db.one("""SELECT rate, threshold FROM tax_rule
                  WHERE code = ? AND (org_id = ? OR org_id IS NULL) AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
                  ORDER BY org_id IS NULL, valid_from DESC LIMIT 1""", (code, org_id, on, on))
    if not r:
        raise Invalid(f"no tax rule {code} in force on {on}")
    return D(r["rate"]), (D(r["threshold"]) if r["threshold"] is not None else None)


def account_for(db: Db, org_id: str, branch_id: str | None, method: str) -> str:
    """Money account a payment method lands in: the branch drawer for cash, the org wallet otherwise."""
    kind = db.scalar("SELECT default_account_kind FROM payment_method WHERE code = ?", (method,))
    if not kind:
        raise Invalid("unknown payment method", method=method)
    acc = None
    for k in (kind, *({"CASH_DRAWER": ("SAFE", "PETTY_CASH")}.get(kind, ()))):   # head office pays cash from the safe
        acc = db.scalar("""SELECT id FROM money_account WHERE org_id = ? AND kind = ? AND is_active
                           AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id IS NULL LIMIT 1""", (org_id, k, branch_id))
        if acc:
            break
    if not acc:
        raise Invalid("no money account for method", method=method, kind=kind)
    return acc


def cash_move(db: Db, actor: Actor, account_id: str, amount: Decimal, kind: str, label: str,
              source_type: str, source_id: str, on: str | None = None, branch_id: str | None = None) -> None:
    db.insert("cash_movement", {"id": new_id("cm"), "org_id": actor.org_id, "branch_id": branch_id, "money_account_id": account_id,
                                "occurred_on": on or business_date(), "amount": money(amount), "kind": kind, "label": label,
                                "source_type": source_type, "source_id": source_id, "created_by": actor.user_id})


def apply_stock(db: Db, actor: Actor, branch_id: str, item_id: str, qty: Decimal, kind: str,
                unit_cost: Decimal | None = None, allow_negative: bool = True, alert: dict | None = None, **refs: str) -> Decimal:
    """Write a stock_movement and update the branch_stock projection; returns the new on-hand.

    The Manager's LOW STOCK alert fires when stock crosses the reorder point. With `alert` (the kitchen's
    "Ingredients used" step) it fires on every deduction that leaves the item at or below it, and carries
    the dish and portion that used it: {"dish", "orderNumber", "used", "unit"}."""
    s = db.one("SELECT * FROM branch_stock WHERE branch_id = ? AND item_id = ?", (branch_id, item_id))
    if not s:
        db.insert("branch_stock", {"org_id": actor.org_id, "branch_id": branch_id, "item_id": item_id, "on_hand": 0})
        s = {"on_hand": 0, "avg_unit_cost": None, "last_unit_cost": None}
    on_hand = D(s["on_hand"])
    new = on_hand + qty
    if new < 0 and not allow_negative:
        raise Conflict("not enough stock", item_id=item_id, on_hand=str(on_hand), requested=str(-qty))
    changes: dict[str, Any] = {"on_hand": new}
    if qty > 0 and unit_cost is not None:          # moving weighted average on receipt
        avg = D(s["avg_unit_cost"] or s["last_unit_cost"] or unit_cost)
        base = max(on_hand, Decimal(0))
        changes["avg_unit_cost"] = ((base * avg + qty * unit_cost) / (base + qty)).quantize(Decimal("0.0001"))
        changes["last_unit_cost"] = money(unit_cost)
    db.update("branch_stock", {"branch_id": branch_id, "item_id": item_id}, changes)
    db.insert("stock_movement", {"id": new_id("sm"), "org_id": actor.org_id, "branch_id": branch_id, "item_id": item_id,
                                 "qty_delta": qty, "unit_cost": unit_cost, "kind": kind, "created_by": actor.user_id, **refs})
    reorder = D(db.scalar("SELECT reorder_point FROM branch_stock WHERE branch_id = ? AND item_id = ?", (branch_id, item_id)))
    crossed = qty < 0 and new <= reorder < on_hand
    if crossed or (alert and qty < 0 and reorder > 0 and new <= reorder):   # → Manager's LOW STOCK alert
        payload: dict[str, Any] = {"itemId": item_id, "onHand": str(new), "reorderPoint": str(reorder)}
        if alert:
            it = db.one("SELECT name_key, custom_name, unit_code FROM inventory_item WHERE id = ?", (item_id,))
            name = (it or {}).get("custom_name") or text_en(db, (it or {}).get("name_key")) or item_id
            unit = (it or {}).get("unit_code") or ""
            payload |= {**alert, "itemName": name, "unit": unit,
                        "message": f"{name} stock low — {fmt_qty(D(alert['used']), alert['unit'])} used in {alert['dish']} "
                                   f"#{alert['orderNumber']}. Current: {fmt_qty(new, unit)}, Reorder point: {fmt_qty(reorder, unit)}"}
        outbox(db, actor.org_id, branch_id, "stock.low", "low", "branch_stock", item_id, payload)
    return new


def text_en(db: Db, key: str | None) -> str | None:
    if not key:
        return None
    return db.scalar("SELECT text FROM i18n_text WHERE key = ? AND lang = 'en' ORDER BY org_id IS NULL LIMIT 1", (key,))


def fmt_qty(q: Decimal, unit: str) -> str:
    """500 g rather than 0.5 kg for small amounts; trailing zeros dropped."""
    if unit == "kg" and abs(q) < 1:
        q, unit = q * 1000, "g"
    if unit == "liters" and abs(q) < 1:
        q, unit = q * 1000, "ml"
    n = f"{q.quantize(Decimal('0.001')):f}".rstrip("0").rstrip(".")
    short = {"liters": "L", "pcs": "pcs"}.get(unit, unit)
    return f"{n}{short}" if short in ("kg", "g", "L", "ml") else f"{n} {short}"


# ================================================================== POS → KDS

def _shift_for(db: Db, org_id: str, branch_id: str, at: datetime) -> str:
    t = at.astimezone(ADDIS).strftime("%H:%M")
    rows = db.all("""SELECT code, start_time, end_time FROM shift_template WHERE org_id = ? AND is_active
                     AND (branch_id = ? OR branch_id IS NULL) ORDER BY branch_id IS NULL, start_time""", (org_id, branch_id))
    # the latest shift that has started (DAY overlaps MORNING/EVENING; EVENING wins after 14:00)
    started = [r for r in rows if str(r["start_time"])[:5] <= t]
    return (started[-1] if started else rows[0])["code"] if rows else "DAY"


def create_order(db: Db, actor: Actor, branch_id: str, order_type: str, lines: list[dict],
                 table_number: str | None = None, customer_name: str | None = None, client_ref: str | None = None) -> dict:
    if client_ref:
        prev = db.one("SELECT id FROM customer_order WHERE org_id = ? AND client_ref = ?", (actor.org_id, client_ref))
        if prev:
            return order_view(db, prev["id"])
    if not lines:
        raise Invalid("an order needs at least one line")
    now = datetime.now(timezone.utc)
    bd = business_date()
    seq = int(db.scalar("SELECT count(*) FROM customer_order WHERE branch_id = ? AND business_date = ?", (branch_id, bd))) + 1
    oid = new_id("ord")
    db.insert("customer_order", {"id": oid, "org_id": actor.org_id, "branch_id": branch_id, "order_number": f"{seq:03d}",
                                 "business_date": bd, "shift_code": _shift_for(db, actor.org_id, branch_id, now),
                                 "order_type": order_type, "table_number": table_number, "customer_name": customer_name,
                                 "opened_by": actor.user_id, "client_ref": client_ref})
    add_lines(db, actor, oid, lines)
    audit(db, actor, "POS", "customer_order.create", "customer_order", oid, "Order {orderNumber} opened",
          {"orderNumber": f"{seq:03d}", "lines": len(lines)}, branch_id=branch_id)
    return order_view(db, oid)


def add_lines(db: Db, actor: Actor, order_id: str, lines: list[dict]) -> None:
    o = _get(db, "customer_order", order_id, actor.org_id)
    if o["status"] not in ("OPEN", "SENT"):
        raise Conflict("order is closed", status=o["status"])
    n = int(db.scalar("SELECT coalesce(max(line_no), 0) FROM order_line WHERE order_id = ?", (order_id,)))
    vat_rate = D(db.scalar("SELECT CASE WHEN is_vat_enabled THEN vat_rate ELSE 0 END FROM organization WHERE id = ?", (actor.org_id,)))
    for ln in lines:
        m = db.one("""SELECT v.*, mi.name_key FROM v_branch_menu v JOIN menu_item mi ON mi.id = v.menu_item_id
                      WHERE v.branch_id = ? AND v.menu_item_id = ?""", (o["branch_id"], ln["menu_item_id"]))
        if not m or not m["is_available"]:
            raise Invalid("menu item not available at this branch", menu_item_id=ln["menu_item_id"])
        if ln.get("id") and db.scalar("SELECT 1 FROM order_line WHERE id = ?", (ln["id"],)):
            continue                                  # a retried request: this line is already on the check
        n += 1
        lid = ln.get("id") or new_id("ol")
        mods = ln.get("modifiers") or []
        mod_rows, mod_total = [], Decimal(0)
        for md in mods:
            delta, name = Decimal(0), md.get("name")
            if md.get("modifier_id"):
                mr = db.one("SELECT price_delta, name_key FROM modifier WHERE id = ? AND org_id = ?", (md["modifier_id"], actor.org_id))
                if not mr:
                    raise Invalid("unknown modifier", modifier_id=md["modifier_id"])
                delta = D(mr["price_delta"])
                name = name or db.scalar("SELECT text FROM i18n_text WHERE key = ? AND lang = 'en'", (mr["name_key"],)) or md["modifier_id"]
            mod_total += delta
            mod_rows.append({"id": new_id("olm"), "order_line_id": lid, "modifier_id": md.get("modifier_id"),
                             "name": name or "Note", "note": md.get("note"), "price_delta": delta})
        en = db.scalar("SELECT text FROM i18n_text WHERE key = ? AND lang = 'en' AND org_id IS NULL", (m["name_key"],)) or m["menu_item_id"]
        db.insert("order_line", {"id": lid, "order_id": order_id, "line_no": n, "menu_item_id": m["menu_item_id"], "item_name": en,
                                 "revenue_class": m["revenue_class"], "station_code": m["station_code"],
                                 "quantity": D(ln.get("quantity", 1)), "unit_price": money(m["price"]), "modifiers_total": mod_total,
                                 "vat_rate": vat_rate, "note": ln.get("note"), "course": ln.get("course", 1)})
        for r in mod_rows:
            db.insert("order_line_modifier", r)
    _recompute_totals(db, order_id)


def _recompute_totals(db: Db, order_id: str) -> None:
    rows = db.all("SELECT line_total, vat_rate FROM order_line WHERE order_id = ? AND status = 'ACTIVE'", (order_id,))
    gross = sum((money(r["line_total"]) for r in rows), Decimal(0))
    vat = money(sum((D(r["line_total"]) * D(r["vat_rate"]) / (1 + D(r["vat_rate"])) for r in rows), Decimal(0)))
    db.update("customer_order", {"id": order_id}, {"total_gross": gross, "vat_amount": vat})


def order_view(db: Db, order_id: str) -> dict:
    o = db.one("SELECT * FROM customer_order WHERE id = ?", (order_id,))
    o["lines"] = db.all("SELECT * FROM order_line WHERE order_id = ? ORDER BY line_no", (order_id,))
    o["payments"] = db.all("SELECT * FROM order_payment WHERE order_id = ? ORDER BY received_at", (order_id,))
    return o


def floor_event(db: Db, org_id: str, branch_id: str, kind: str, order: dict) -> None:
    """Tell the Waiter / Manager / Cashier screens a table changed (they refetch the floor)."""
    if order.get("table_id"):
        outbox(db, org_id, branch_id, "floor", kind, "customer_order", order["id"],
               {"orderId": order["id"], "tableId": order["table_id"], "table": order.get("table_number"), "waiterId": order.get("waiter_id")})


def send_to_kitchen(db: Db, actor: Actor, order_id: str, *, course: int | None = None, line_ids: list[str] | None = None) -> dict:
    """Fire active lines not yet on a ticket as a new KDS ticket (later courses → later tickets).
    With `course` or `line_ids` only those lines are fired; the rest stay held on the check."""
    o = _get(db, "customer_order", order_id, actor.org_id)
    if o["status"] in ("VOIDED", "REFUNDED"):
        raise Conflict("order is voided")
    lines = db.all("""SELECT * FROM order_line l WHERE l.order_id = ? AND l.status = 'ACTIVE'
                      AND NOT EXISTS (SELECT 1 FROM kds_ticket_item i WHERE i.order_line_id = l.id) ORDER BY line_no""", (order_id,))
    if course is not None:
        lines = [ln for ln in lines if int(ln["course"]) == int(course)]
    if line_ids is not None:
        lines = [ln for ln in lines if ln["id"] in set(line_ids)]
    if not lines:
        raise Conflict("nothing new to send")
    seq = int(db.scalar("SELECT coalesce(max(fire_seq), 0) FROM kds_ticket WHERE order_id = ?", (order_id,))) + 1
    tid = new_id("kt")
    db.insert("kds_ticket", {"id": tid, "org_id": actor.org_id, "branch_id": o["branch_id"], "order_id": order_id, "fire_seq": seq,
                             "order_number": o["order_number"] + (f"-{seq}" if seq > 1 else ""), "order_type": o["order_type"],
                             "table_number": o["table_number"], "customer_name": o["customer_name"],
                             "submitted_by": actor.user_id, "created_at": now_iso()})
    for ln in lines:
        db.insert("kds_ticket_item", {"id": new_id("kti"), "ticket_id": tid, "order_line_id": ln["id"], "menu_item_id": ln["menu_item_id"],
                                      "item_name": ln["item_name"], "quantity": ln["quantity"], "station_code": ln["station_code"],
                                      "is_completed": False})
    if o["status"] == "OPEN":
        db.update("customer_order", {"id": order_id}, {"status": "SENT"})
    ticket = kds_payload(db, tid)
    outbox(db, actor.org_id, o["branch_id"], "kds.ticket", "upsert", "kds_ticket", tid, {"type": "upsert", "ticket": ticket})
    floor_event(db, actor.org_id, o["branch_id"], "sent", o)
    audit(db, actor, "POS", "customer_order.send", "kds_ticket", tid, "Order {orderNumber} sent to kitchen",
          {"orderNumber": o["order_number"], "items": len(lines)}, branch_id=o["branch_id"])
    return ticket


# ---- KDS wire format (kitchen-display/src/types.ts KitchenTicket) ----

def kds_payload(db: Db, ticket_id: str) -> dict:
    t = db.one("SELECT * FROM kds_ticket WHERE id = ?", (ticket_id,))
    items = db.all("""SELECT i.*, l.note AS line_note FROM kds_ticket_item i JOIN order_line l ON l.id = i.order_line_id
                      WHERE i.ticket_id = ? AND NOT i.is_voided ORDER BY l.line_no""", (ticket_id,))
    out_items = []
    for i in items:
        mods = db.all("SELECT id, modifier_id, name, note FROM order_line_modifier WHERE order_line_id = ?", (i["order_line_id"],))
        m = [{"id": x["modifier_id"] or x["id"], "name": x["name"], **({"note": x["note"]} if x["note"] else {})} for x in mods]
        if i["line_note"]:
            m.append({"id": f"note-{i['order_line_id']}", "name": "", "note": i["line_note"]})
        out_items.append({"id": i["id"], "itemName": i["item_name"], "menuItemId": i["menu_item_id"], "station": i["station_code"],
                          "quantity": float(D(i["quantity"])), "isCompleted": bool(i["is_completed"]), **({"modifiers": m} if m else {})})
    created = _dt(t["created_at"])
    end = _dt(t["ready_at"]) if t["ready_at"] else datetime.now(timezone.utc)
    p = {"id": t["id"], "orderNumber": t["order_number"], "orderType": t["order_type"], "items": out_items,
         "status": t["status"] if t["status"] in ("PENDING", "PREPARING", "READY") else (t["bumped_from_status"] or "READY"),
         "createdAt": _iso(t["created_at"]), "elapsedMinutes": max(0, int((end - created).total_seconds() // 60)),
         "submittedBy": t["submitted_by"], "branchId": t["branch_id"], "version": t["version"]}
    p["submittedByName"] = db.scalar("SELECT full_name FROM app_user WHERE id = ?", (t["submitted_by"],))
    for k_src, k_dst in (("table_number", "tableNumber"), ("customer_name", "customerName"),
                         ("started_at", "startedAt"), ("ready_at", "readyAt")):
        if t[k_src]:
            p[k_dst] = _iso(t[k_src])
    return p


def kds_snapshot(db: Db, branch_id: str) -> dict:
    ids = db.all("""SELECT id FROM kds_ticket WHERE branch_id = ? AND status IN ('PENDING','PREPARING','READY')
                    ORDER BY created_at""", (branch_id,))
    return {"type": "snapshot", "tickets": [kds_payload(db, r["id"]) for r in ids]}


# ---- "Ingredients used": the kitchen confirms what each dish really took when it marks a ticket ready ----

LOW_SOON = Decimal("1.2")          # kitchen heads-up when stock is at or within 20 % above the reorder point


def _names(db: Db, key: str | None, custom: str | None = None) -> dict:
    """{"en","am","om"} for a text key (platform text, then the organisation's own)."""
    out = {"en": custom or "", "am": "", "om": ""}
    if key:
        for r in db.all("SELECT lang, text FROM i18n_text WHERE key = ? ORDER BY org_id IS NOT NULL", (key,)):
            out[r["lang"]] = r["text"]
    out["en"] = custom or out["en"] or (key or "").split(".", 1)[-1]
    return {k: v or out["en"] for k, v in out.items()}


def ticket_ingredients(db: Db, actor: Actor, ticket_id: str) -> dict:
    """What the confirmation step shows: every dish on the ticket not yet recorded, with its recipe × quantity
    pre-filled, plus the branch's stock items (to add something the recipe doesn't list)."""
    t = _get(db, "kds_ticket", ticket_id, actor.org_id)
    if actor.branch_id and t["branch_id"] != actor.branch_id and actor.role != "ADMIN":
        raise NotFound("kds_ticket not found", id=ticket_id)
    items = db.all("""SELECT i.* FROM kds_ticket_item i JOIN order_line l ON l.id = i.order_line_id
                      WHERE i.ticket_id = ? AND NOT i.is_voided ORDER BY l.line_no""", (ticket_id,))
    done = {r["ticket_item_id"] for r in db.all("SELECT DISTINCT ticket_item_id FROM dish_ingredient_usage WHERE ticket_id = ?", (ticket_id,))}
    stock = {r["item_id"]: r for r in db.all("SELECT item_id, on_hand, reorder_point FROM branch_stock WHERE branch_id = ?", (t["branch_id"],))}
    dishes = []
    for i in items:
        if i["id"] in done:
            continue
        q = D(i["quantity"])
        comps = db.all("""SELECT r.inventory_item_id, r.quantity, r.unit_code, inv.name_key, inv.custom_name FROM recipe_component r
                          JOIN inventory_item inv ON inv.id = r.inventory_item_id
                          WHERE r.menu_item_id = ? AND inv.deleted_at IS NULL ORDER BY r.inventory_item_id""", (i["menu_item_id"],))
        dishes.append({"ticketItemId": i["id"], "menuItemId": i["menu_item_id"], "dishName": i["item_name"],
                       "dishNames": _names(db, db.scalar("SELECT name_key FROM menu_item WHERE id = ?", (i["menu_item_id"],)), None),
                       "quantity": float(q),
                       "ingredients": [{"itemId": c["inventory_item_id"], "names": _names(db, c["name_key"], c["custom_name"]),
                                        "unit": c["unit_code"], "expected": float((D(c["quantity"]) * q).quantize(Decimal("0.001"))),
                                        "onHand": float(D((stock.get(c["inventory_item_id"]) or {}).get("on_hand") or 0))}
                                       for c in comps]})
    catalog = [{"itemId": r["id"], "names": _names(db, r["name_key"], r["custom_name"]), "unit": r["unit_code"]}
               for r in db.all("""SELECT i.id, i.name_key, i.custom_name, i.unit_code FROM inventory_item i
                                  JOIN inventory_main_category m ON m.code = i.main_category_code
                                  WHERE i.org_id = ? AND i.deleted_at IS NULL AND m.cost_category_code IN ('RAW_INGREDIENTS','BEVERAGE_BAR')
                                  ORDER BY i.id""", (actor.org_id,))]
    units = {r["code"]: _names(db, r["name_key"]) for r in db.all("SELECT code, name_key FROM unit")}
    return {"ticketId": ticket_id, "orderNumber": t["order_number"], "dishes": dishes, "items": catalog, "units": units,
            "needed": any(d["ingredients"] for d in dishes)}


def record_ingredient_use(db: Db, actor: Actor, ticket: dict, usage: list[dict]) -> list[dict]:
    """Deduct what the kitchen says each dish used (not the recipe) and log expected vs actual.
    Runs in the same transaction as the READY status change, so either both happen or neither does.
    Returns the kitchen's heads-up list: items now at or within 20 % above their reorder point."""
    items = {r["id"]: r for r in db.all("SELECT * FROM kds_ticket_item WHERE ticket_id = ? AND NOT is_voided", (ticket["id"],))}
    done = {(r["ticket_item_id"], r["inventory_item_id"]) for r in
            db.all("SELECT ticket_item_id, inventory_item_id FROM dish_ingredient_usage WHERE ticket_id = ?", (ticket["id"],))}
    touched: dict[str, None] = {}
    for u in usage:
        ti = items.get(u.get("ticketItemId") or "")
        if not ti:
            raise Invalid("that dish is not on this ticket", ticketItemId=u.get("ticketItemId"))
        item_id = u.get("itemId") or ""
        inv = db.one("SELECT * FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (item_id, actor.org_id))
        if not inv:
            raise Invalid("unknown stock item", itemId=item_id)
        try:
            actual = D(u.get("actual"))
        except Exception:  # noqa: BLE001
            raise Invalid("enter an amount for every ingredient", itemId=item_id) from None
        if actual < 0:
            raise Invalid("an amount can't be below 0", itemId=item_id)
        if (ti["id"], item_id) in done:
            continue                                   # already recorded (e.g. the ticket went back and forth)
        done.add((ti["id"], item_id))
        rc = db.one("SELECT quantity, unit_code FROM recipe_component WHERE menu_item_id = ? AND inventory_item_id = ?",
                    (ti["menu_item_id"], item_id))
        unit = u.get("unit") or (rc or {}).get("unit_code") or inv["unit_code"]
        if not db.scalar("SELECT 1 FROM unit WHERE code = ?", (unit,)):
            raise Invalid("unknown unit", unit=unit)
        expected = (D(rc["quantity"]) * D(ti["quantity"])).quantize(Decimal("0.001")) if rc else Decimal(0)
        stock_qty, _ = in_item_units(db, item_id, actual, unit, Decimal(0))
        if stock_qty > 0:
            apply_stock(db, actor, ticket["branch_id"], item_id, -stock_qty, "SALE_DEPLETION", order_line_id=ti["order_line_id"],
                        alert={"dish": ti["item_name"], "orderNumber": ticket["order_number"], "used": str(actual), "unit": unit,
                               "ticketId": ticket["id"]})
        db.insert("dish_ingredient_usage", {
            "id": new_id("diu"), "org_id": actor.org_id, "branch_id": ticket["branch_id"], "ticket_id": ticket["id"],
            "ticket_item_id": ti["id"], "order_id": ticket["order_id"], "order_number": ticket["order_number"],
            "menu_item_id": ti["menu_item_id"], "dish_name": ti["item_name"], "inventory_item_id": item_id, "unit_code": unit,
            "expected_qty": expected, "actual_qty": actual, "stock_qty": stock_qty, "staff_id": actor.user_id, "recorded_at": now_iso()})
        touched[item_id] = None
    warnings = []
    for item_id in touched:
        s = db.one("""SELECT b.on_hand, b.reorder_point, i.name_key, i.custom_name, i.unit_code FROM branch_stock b
                      JOIN inventory_item i ON i.id = b.item_id WHERE b.branch_id = ? AND b.item_id = ?""", (ticket["branch_id"], item_id))
        if not s:
            continue
        on_hand, reorder = D(s["on_hand"]), D(s["reorder_point"])
        if reorder > 0 and on_hand <= reorder * LOW_SOON:
            warnings.append({"itemId": item_id, "names": _names(db, s["name_key"], s["custom_name"]), "unit": s["unit_code"],
                             "onHand": float(on_hand), "reorderPoint": float(reorder), "low": on_hand <= reorder})
    if usage:
        audit(db, actor, "KDS", "kds_ticket.ingredients", "kds_ticket", ticket["id"], "Ticket {orderNumber}: ingredients used",
              {"orderNumber": ticket["order_number"], "lines": len(usage)}, branch_id=ticket["branch_id"])
    return warnings


def last_kitchen_use(db: Db, branch_id: str, days: int = 3) -> list[dict]:
    """The latest "Ingredients used" entry per stock item (the Manager's low-stock card shows it as context)."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out: dict[str, dict] = {}
    for r in db.all("""SELECT inventory_item_id, dish_name, order_number, actual_qty, unit_code, recorded_at FROM dish_ingredient_usage
                       WHERE branch_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC""", (branch_id, since)):
        if r["inventory_item_id"] in out:
            continue
        out[r["inventory_item_id"]] = {"itemId": r["inventory_item_id"], "dish": r["dish_name"], "orderNumber": r["order_number"],
                                       "used": float(r["actual_qty"]), "unit": r["unit_code"],
                                       "text": fmt_qty(D(r["actual_qty"]), r["unit_code"]), "at": _iso(r["recorded_at"])}
    return list(out.values())


def usage_for_order(db: Db, order_id: str) -> list[dict]:
    return [{"dish": r["dish_name"], "itemId": r["inventory_item_id"], "item": text_en(db, f"inv.{r['inventory_item_id']}") or r["inventory_item_id"],
             "unit": r["unit_code"], "expected": float(r["expected_qty"]), "actual": float(r["actual_qty"]), "recordedAt": _iso(r["recorded_at"])}
            for r in db.all("SELECT * FROM dish_ingredient_usage WHERE order_id = ? ORDER BY recorded_at, dish_name", (order_id,))]


_METHOD = {"CASH": "Cash", "TELEBIRR": "Telebirr", "CBE_BIRR": "CBE Birr", "MPESA": "M-Pesa", "CARD": "Card", "BANK_TRANSFER": "Bank transfer"}


def transaction_detail(db: Db, org_id: str, kind: str, tid: str) -> dict:
    """One Owner-app transaction in full: items, VAT, payment, status and who decided, who created it."""
    def person(uid: str | None) -> dict | None:
        if not uid:
            return None
        u = db.one("SELECT full_name, role_code FROM app_user WHERE id = ?", (uid,))
        return {"name": u["full_name"], "role": text_en(db, f"role.{u['role_code']}") or u["role_code"]} if u else {"name": uid, "role": ""}

    def branch(bid: str | None) -> str:
        return (db.scalar("SELECT name FROM branch WHERE id = ?", (bid,)) or "Head office") if bid else "Head office"

    def item_name(item_id: str) -> str:
        r = db.one("SELECT name_key, custom_name FROM inventory_item WHERE id = ?", (item_id,))
        return (r and (r["custom_name"] or text_en(db, r["name_key"]))) or item_id

    if kind == "order":
        o = _get(db, "customer_order", tid, org_id)
        lines = [{"item": ln["item_name"], "quantity": float(ln["quantity"]), "unit": "pcs", "unitPrice": float(money(D(ln["unit_price"]) + D(ln["modifiers_total"] or 0))),
                  "total": float(money(ln["line_total"])), **({"note": "Voided: " + (ln["void_reason"] or "")} if ln["status"] == "VOIDED" else {})}
                 for ln in db.all("SELECT * FROM order_line WHERE order_id = ? ORDER BY line_no", (tid,))]
        pays = [{"method": _METHOD.get(r["payment_method_code"], r["payment_method_code"]), "amount": float(r["amount"]),
                 **({"reference": r["reference"]} if r["reference"] else {}), "at": _iso(r["received_at"]), "by": person(r["received_by"])}
                for r in db.all("SELECT * FROM order_payment WHERE order_id = ? AND status = 'CAPTURED' ORDER BY received_at", (tid,))]
        table = db.scalar("SELECT name FROM dining_table WHERE id = ?", (o.get("table_id"),)) if o.get("table_id") else o["table_number"]
        return {"kind": kind, "id": tid, "number": o["receipt_no"] or f"ORD-{o['order_number']}", "type": "Sale",
                "at": _iso(o["paid_at"] or o["created_at"]), "branch": branch(o["branch_id"]),
                "where": (f"Table {table}" if table else ("Takeaway" if o["order_type"] in ("TAKEOUT", "TAKEAWAY") else "Counter")),
                "lines": lines, "vat": float(money(o["vat_amount"])), "total": float(money(o["total_gross"])), "payments": pays,
                "status": {"code": o["status"], "label": "Paid" if o["status"] == "PAID" else o["status"].title()},
                "createdBy": person(o["opened_by"]), **({"waiter": person(o["waiter_id"])} if o.get("waiter_id") else {}),
                "ingredients": usage_for_order(db, tid)}
    if kind == "purchase":
        r = _get(db, "purchase", tid, org_id)
        st = r["review_status"]
        return {"kind": kind, "id": tid, "number": f"PUR-{tid[-6:].upper()}", "type": "Purchase", "at": _iso(r["purchased_at"]),
                "branch": branch(r["branch_id"]), "vendor": r["vendor_name"],
                "lines": [{"item": item_name(r["item_id"]), "quantity": float(r["quantity"]), "unit": r["unit_code"],
                           "unitPrice": float(r["unit_cost"]), "total": float(r["total_cost"])}],
                "vat": float(r["vat_amount"]), "total": float(r["total_cost"]),
                "payments": [{"method": _METHOD.get(r["payment_method_code"], r["payment_method_code"]) if r["payment_method_code"] else "On credit",
                              "amount": float(r["total_cost"])}],
                "status": {"code": st, "label": {"PENDING": "Waiting for the manager", "APPROVED": "Approved", "FLAGGED": "Flagged",
                                                 "REJECTED": "Rejected"}.get(st, st),
                           **({"decidedBy": person(r["reviewed_by"]), "decidedAt": _iso(r["reviewed_at"])} if r["reviewed_by"] else {}),
                           **({"reason": r["flag_reason"]} if r["flag_reason"] else {})},
                "createdBy": person(r["logged_by"]), **({"note": r["note"]} if r["note"] else {}),
                **({"receiptNo": r["receipt_no"]} if r["receipt_no"] else {})}
    if kind == "expense":
        e = _get(db, "expense", tid, org_id)
        st = e["review_status"]
        return {"kind": kind, "id": tid, "number": f"EXP-{tid[-6:].upper()}", "type": "Expense", "at": _iso(e["spent_at"]),
                "branch": branch(e["branch_id"]),
                "lines": [{"item": e["reason"], "quantity": 1, "unit": "", "unitPrice": float(e["amount"]), "total": float(e["amount"])}],
                "vat": float(e["vat_amount"]), "total": float(e["amount"]),
                "payments": [{"method": _METHOD.get(e["payment_method_code"], e["payment_method_code"]), "amount": float(e["amount"])}],
                "status": {"code": st, "label": {"PENDING": "Recorded", "APPROVED": "Approved", "FLAGGED": "Flagged", "REJECTED": "Rejected"}.get(st, st),
                           **({"decidedBy": person(e["reviewed_by"]), "decidedAt": _iso(e["reviewed_at"])} if e["reviewed_by"] else {})},
                "createdBy": person(e["logged_by"]), **({"note": e["note"]} if e["note"] else {})}
    if kind == "bill":
        b = _get(db, "bill", tid, org_id)
        v = db.one("SELECT name FROM vendor WHERE id = ?", (b["vendor_id"],))
        pays = [{"method": _METHOD.get(r["payment_method_code"], r["payment_method_code"]), "amount": float(r["amount"]),
                 **({"reference": r["reference"]} if r["reference"] else {}), "at": str(r["paid_on"])[:10], "by": person(r["paid_by"])}
                for r in db.all("SELECT * FROM bill_payment WHERE bill_id = ? ORDER BY paid_on", (tid,))]
        return {"kind": kind, "id": tid, "number": b["bill_no"], "type": "Bill", "at": str(b["issue_date"])[:10], "branch": branch(b["branch_id"]),
                "vendor": v["name"] if v else "", "dueDate": str(b["due_date"])[:10],
                "lines": [{"item": ln["description"], "quantity": float(ln["quantity"] or 1), "unit": ln["unit_code"] or "",
                           "unitPrice": float(money(D(ln["amount"]) / (D(ln["quantity"]) or 1))) if ln["quantity"] else float(ln["amount"]),
                           "total": float(money(D(ln["amount"]) + D(ln["vat"] or 0)))}
                          for ln in db.all("SELECT * FROM bill_line WHERE bill_id = ?", (tid,))]
                         or [{"item": b["description"] or "Bill", "quantity": 1, "unit": "", "unitPrice": float(b["subtotal"]), "total": float(b["total"])}],
                "vat": float(b["vat"]), "total": float(b["total"]), "payments": pays,
                "status": {"code": b["status"], "label": b["status"].title()}, "createdBy": person(b["entered_by"])}
    if kind == "payroll":
        r = _get(db, "payroll_run", tid, org_id)
        return {"kind": kind, "id": tid, "number": f"PAY-{str(r['period_month'])[:7]}", "type": "Payroll",
                "at": str(r["paid_on"] or r["approved_at"] or r["period_month"])[:10], "branch": branch(r["branch_id"]),
                "lines": [{"item": "Gross pay", "quantity": 1, "unit": "", "unitPrice": float(r["total_gross"]), "total": float(r["total_gross"])},
                          {"item": "Employer pension (11%)", "quantity": 1, "unit": "", "unitPrice": float(r["total_pension_employer"]),
                           "total": float(r["total_pension_employer"])}],
                "vat": 0, "total": float(D(r["total_gross"]) + D(r["total_pension_employer"])), "payments": [],
                "status": {"code": r["status"], "label": r["status"].title(),
                           **({"decidedBy": person(r["approved_by"]), "decidedAt": _iso(r["approved_at"])} if r["approved_by"] else {})},
                "createdBy": person(r["approved_by"])}
    raise NotFound("unknown transaction", kind=kind, id=tid)


def set_recipe(db: Db, actor: Actor, menu_item_id: str, components: list[dict]) -> list[dict]:
    """Replace a dish's recipe (per portion). The kitchen's confirmation step pre-fills from it."""
    m = _get(db, "menu_item", menu_item_id, actor.org_id)
    rows = []
    for c in components:
        q = D(c.get("quantity"))
        if q <= 0:
            raise Invalid("each ingredient needs an amount above 0", itemId=c.get("itemId"))
        inv = db.one("SELECT unit_code FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (c.get("itemId"), actor.org_id))
        if not inv:
            raise NotFound("inventory item not found", item_id=c.get("itemId"))
        unit = c.get("unit") or inv["unit_code"]
        if not db.scalar("SELECT 1 FROM unit WHERE code = ?", (unit,)):
            raise Invalid("unknown unit", unit=unit)
        rows.append({"menu_item_id": m["id"], "inventory_item_id": c["itemId"], "quantity": q, "unit_code": unit})
    before = db.all("SELECT inventory_item_id, quantity, unit_code FROM recipe_component WHERE menu_item_id = ?", (m["id"],))
    db.execute("DELETE FROM recipe_component WHERE menu_item_id = ?", (m["id"],))
    for r in rows:
        db.insert("recipe_component", r)
    audit(db, actor, "ADMIN", "recipe.set", "menu_item", m["id"], "Recipe changed: {dish}", {"dish": m["name_key"], "lines": len(rows)},
          before={"lines": [dict(b) for b in before]}, after={"lines": len(rows)})
    return recipe_of(db, m["id"])


def recipe_of(db: Db, menu_item_id: str) -> list[dict]:
    return [{"itemId": r["inventory_item_id"], "quantity": float(r["quantity"]), "unit": r["unit_code"]}
            for r in db.all("SELECT * FROM recipe_component WHERE menu_item_id = ? ORDER BY inventory_item_id", (menu_item_id,))]


def kds_command(db: Db, actor: Actor, ticket_id: str, cmd: str, body: dict) -> dict:
    """status | item | notify | bump | recall — same semantics as kitchen-display's demo feed.
    notify: some dishes are ticked done but not all; tell the floor those are ready and leave the rest alone."""
    t = _get(db, "kds_ticket", ticket_id, actor.org_id)
    if actor.branch_id and t["branch_id"] != actor.branch_id and actor.role != "ADMIN":
        raise NotFound("kds_ticket not found", id=ticket_id)
    if body.get("expectedVersion") is not None and int(body["expectedVersion"]) != int(t["version"]):
        raise Conflict("ticket changed on another screen", version=t["version"])
    at = body.get("at") or now_iso()
    warnings: list[dict] | None = None
    active = t["status"] in ("PENDING", "PREPARING", "READY")
    ch: dict[str, Any] = {}
    event = "upsert"
    if cmd == "status":
        st = body["status"]
        if st not in ("PENDING", "PREPARING", "READY"):
            raise Invalid("bad status", status=st)
        if not active:
            raise Conflict("ticket is not on the board", status=t["status"])
        ch["status"] = st
        if st == "PENDING":
            ch.update(started_at=None, ready_at=None)
        elif st == "PREPARING":
            ch.update(started_at=t["started_at"] or at, ready_at=None)
        else:
            ch.update(ready_at=at, started_at=t["started_at"] or at)
            db.execute("""UPDATE kds_ticket_item SET is_completed = ?, completed_at = coalesce(completed_at, ?),
                          completed_by = coalesce(completed_by, ?) WHERE ticket_id = ?""", (True, at, actor.user_id, ticket_id))
            usage = body.get("usage")
            if usage is not None:            # the "Ingredients used" step: stock follows what the kitchen entered
                if not isinstance(usage, list):
                    raise Invalid("usage must be a list")
                warnings = record_ingredient_use(db, actor, t, usage)
    elif cmd == "item":
        if not active or t["status"] == "READY":
            raise Conflict("ticket is not being prepared", status=t["status"])
        done = bool(body["isCompleted"])
        n = db.update("kds_ticket_item", {"id": body["itemId"], "ticket_id": ticket_id},
                      {"is_completed": done, "completed_at": at if done else None, "completed_by": actor.user_id if done else None})
        if not n:
            raise NotFound("ticket item not found", itemId=body["itemId"])
    elif cmd == "notify":
        if not active or t["status"] == "READY":
            raise Conflict("ticket is not being prepared", status=t["status"])
        if not db.scalar("SELECT count(*) FROM kds_ticket_item WHERE ticket_id = ? AND is_completed AND NOT is_voided", (ticket_id,)):
            raise Conflict("no dish is marked done yet")
        if t["status"] == "PENDING":
            ch.update(status="PREPARING", started_at=t["started_at"] or at)
    elif cmd == "bump":
        if not active:
            raise Conflict("ticket already off the board", status=t["status"])
        ch.update(status="BUMPED", bumped_from_status=t["status"], bumped_at=at, bumped_by=actor.user_id)
        event = "remove"
    elif cmd == "recall":
        if t["status"] != "BUMPED":
            raise Conflict("only picked-up tickets can be recalled", status=t["status"])
        ch.update(status=t["bumped_from_status"] or "READY", bumped_from_status=None, bumped_at=None, bumped_by=None,
                  recalled_at=at, recalled_by=actor.user_id)
    else:
        raise Invalid("unknown command", cmd=cmd)
    if db.dialect == "sqlite" or not ch:          # PostgreSQL bumps version by trigger on any row change
        ch["version"] = int(t["version"]) + 1
    db.update("kds_ticket", {"id": ticket_id}, ch)
    payload = {"type": "remove", "ticketId": ticket_id} if event == "remove" else {"type": "upsert", "ticket": kds_payload(db, ticket_id)}
    outbox(db, actor.org_id, t["branch_id"], "kds.ticket", event, "kds_ticket", ticket_id, payload)
    floor_event(db, actor.org_id, t["branch_id"], "ready" if ch.get("status") == "READY" or cmd == "notify" else "kitchen",
                db.one("SELECT * FROM customer_order WHERE id = ?", (t["order_id"],)))
    audit(db, actor, "KDS", f"kds_ticket.{cmd}", "kds_ticket", ticket_id, "Ticket {orderNumber}: {cmd}",
          {"orderNumber": t["order_number"], "cmd": cmd, **{k: v for k, v in body.items() if k in ("status", "itemId", "isCompleted")}},
          branch_id=t["branch_id"])
    if warnings is not None:      # only for the screen that confirmed (not broadcast to other screens)
        return {**payload, "stockWarnings": warnings}
    return payload


def void_line(db: Db, actor: Actor, line_id: str, reason: str) -> dict:
    """Void a line; if the kitchen already had it, tell the KDS and log a VOID_INCIDENT for HR."""
    if not reason:
        raise Invalid("a void needs a reason")
    ln = db.one("SELECT l.*, o.org_id, o.branch_id, o.order_number, o.opened_by, o.status AS order_status FROM order_line l JOIN customer_order o ON o.id = l.order_id WHERE l.id = ?", (line_id,))
    if not ln or ln["org_id"] != actor.org_id:
        raise NotFound("order line not found")
    if ln["status"] == "VOIDED":
        raise Conflict("already voided")
    db.update("order_line", {"id": line_id}, {"status": "VOIDED", "voided_by": actor.user_id, "voided_at": now_iso(), "void_reason": reason})
    _recompute_totals(db, ln["order_id"])
    item = db.one("SELECT ticket_id FROM kds_ticket_item WHERE order_line_id = ?", (line_id,))
    if item:
        db.update("kds_ticket_item", {"order_line_id": line_id}, {"is_voided": True})
        t = db.one("SELECT status FROM kds_ticket WHERE id = ?", (item["ticket_id"],))
        if t["status"] in ("PENDING", "PREPARING", "READY"):
            left = db.scalar("SELECT count(*) FROM kds_ticket_item WHERE ticket_id = ? AND NOT is_voided", (item["ticket_id"],))
            if int(left) == 0:      # nothing left to cook: take the ticket off the board
                changes: dict[str, Any] = {"status": "VOIDED"}
                if db.dialect == "sqlite":   # PostgreSQL bumps version by trigger
                    changes["version"] = int(db.scalar("SELECT version FROM kds_ticket WHERE id = ?", (item["ticket_id"],))) + 1
                db.update("kds_ticket", {"id": item["ticket_id"]}, changes)
                outbox(db, actor.org_id, ln["branch_id"], "kds.ticket", "remove", "kds_ticket", item["ticket_id"],
                       {"type": "remove", "ticketId": item["ticket_id"]})
            else:
                outbox(db, actor.org_id, ln["branch_id"], "kds.ticket", "upsert", "kds_ticket", item["ticket_id"],
                       {"type": "upsert", "ticket": kds_payload(db, item["ticket_id"])})
        if db.scalar("SELECT 1 FROM employee WHERE user_id = ?", (ln["opened_by"],)):
            db.insert("performance_log", {"id": new_id("pl"), "org_id": actor.org_id, "employee_id": ln["opened_by"],
                                          "branch_id": ln["branch_id"], "log_type": "VOID_INCIDENT", "severity": "LOW",
                                          "note": f"Line voided after it was sent to the kitchen: {ln['item_name']} — {reason}",
                                          "source": "SYSTEM", "ref_type": "order_line", "ref_id": line_id, "logged_by": actor.user_id})
    audit(db, actor, "POS", "order_line.void", "order_line", line_id, "Voided {item} on order {orderNumber}",
          {"item": ln["item_name"], "orderNumber": ln["order_number"], "reason": reason}, branch_id=ln["branch_id"])
    return order_view(db, ln["order_id"])


def cancel_open_order(db: Db, actor: Actor, order_id: str, reason: str = "Abandoned at checkout") -> dict:
    """Drop an order that was never paid nor sent to the kitchen (e.g. the customer walked away
    after a failed Telebirr payment). Anything already sent or paid needs a manager void."""
    o = _get(db, "customer_order", order_id, actor.org_id)
    if o["status"] != "OPEN":
        raise Conflict("only an unsent, unpaid order can be cancelled here", status=o["status"])
    if db.scalar("SELECT 1 FROM order_payment WHERE order_id = ? AND status = 'CAPTURED'", (order_id,)):
        raise Conflict("order has a payment; ask a manager to void it")
    db.update("customer_order", {"id": order_id}, {"status": "VOIDED", "voided_by": actor.user_id, "voided_at": now_iso(), "void_reason": reason})
    audit(db, actor, "POS", "customer_order.cancel", "customer_order", order_id, "Order {orderNumber} cancelled before payment",
          {"orderNumber": o["order_number"], "reason": reason}, branch_id=o["branch_id"])
    return order_view(db, order_id)


def pay_order(db: Db, actor: Actor, order_id: str, payments: list[dict]) -> dict:
    o = _get(db, "customer_order", order_id, actor.org_id)
    if o["status"] in ("PAID", "VOIDED", "REFUNDED"):
        raise Conflict("order is not payable", status=o["status"])
    paid = D(db.scalar("SELECT coalesce(sum(amount), 0) FROM order_payment WHERE order_id = ? AND status = 'CAPTURED'", (order_id,)))
    due = money(o["total_gross"]) - paid
    total = sum((money(p["amount"]) for p in payments), Decimal(0))
    if total > due:
        raise Invalid("payments exceed the amount due", due=str(due), paying=str(total))
    for p in payments:
        meth = db.one("SELECT * FROM payment_method WHERE code = ? AND is_active", (p["method"],))
        if not meth:
            raise Invalid("unknown payment method", method=p["method"])
        if meth["requires_reference"] and not p.get("reference"):
            raise Invalid(f"{p['method']} needs the transaction reference")
        if p.get("reference") and db.scalar("""SELECT 1 FROM order_payment WHERE payment_method_code = ? AND reference = ?
                                                AND status = 'CAPTURED'""", (p["method"], p["reference"])):
            raise Conflict(f"transaction ID {p['reference']} was already used for another payment")
        acc = account_for(db, actor.org_id, o["branch_id"], p["method"])
        pid = new_id("pay")
        db.insert("order_payment", {"id": pid, "order_id": order_id, "payment_method_code": p["method"], "money_account_id": acc,
                                    "amount": money(p["amount"]), "tendered": p.get("tendered"), "reference": p.get("reference"),
                                    "received_by": actor.user_id})
        cash_move(db, actor, acc, money(p["amount"]), "SALES", f"Order {o['order_number']}", "order_payment", pid,
                  on=str(o["business_date"]), branch_id=o["branch_id"])
    if total == due:
        receipt = f"{_branch_code(db, o['branch_id'])}{str(o['business_date']).replace('-', '')}-{o['order_number']}"
        db.update("customer_order", {"id": order_id}, {"status": "PAID", "paid_at": now_iso(), "receipt_no": receipt})
    outbox(db, actor.org_id, o["branch_id"], "mgr.sales", "paid" if total == due else "part_paid", "customer_order", order_id,
           {"orderId": order_id, "orderNumber": o["order_number"], "amount": str(total)})
    floor_event(db, actor.org_id, o["branch_id"], "paid" if total == due else "part_paid", o)
    audit(db, actor, "POS", "customer_order.pay", "customer_order", order_id, "Order {orderNumber} paid {amount} ETB",
          {"orderNumber": o["order_number"], "amount": str(total), "methods": [p["method"] for p in payments]}, branch_id=o["branch_id"])
    return order_view(db, order_id)


def _branch_code(db: Db, branch_id: str) -> str:
    return db.scalar("SELECT code FROM branch WHERE id = ?", (branch_id,))


def close_day(db: Db, actor: Actor, branch_id: str, day: str) -> dict:
    """Z-report: freeze the day's POS totals for Finance and open the reconciliation."""
    if db.scalar("SELECT status FROM daily_sales_summary WHERE branch_id = ? AND business_date = ?", (branch_id, day)) == "CLOSED":
        raise Conflict("day already closed", date=day)
    open_n = int(db.scalar("SELECT count(*) FROM customer_order WHERE branch_id = ? AND business_date = ? AND status IN ('OPEN','SENT')", (branch_id, day)))
    if open_n:
        raise Conflict("close or void open orders first", open_orders=open_n)
    live = db.one("SELECT * FROM v_daily_sales_live WHERE branch_id = ? AND business_date = ?", (branch_id, day)) or {}
    voids = db.one("""SELECT count(*) AS n, coalesce(sum(l.line_total), 0) AS amt FROM order_line l JOIN customer_order o ON o.id = l.order_id
                      WHERE o.branch_id = ? AND o.business_date = ? AND l.status = 'VOIDED'""", (branch_id, day))
    z_no = int(db.scalar("SELECT count(*) FROM daily_sales_summary WHERE branch_id = ? AND status = 'CLOSED'", (branch_id,))) + 1
    gross, vat = money(live.get("gross")), money(live.get("vat"))
    food, bev = money(live.get("food_net")), money(live.get("beverage_net"))
    drift = (gross - vat) - (food + bev)          # rounding: keep food + beverage == net exactly
    food += drift
    db.execute("DELETE FROM daily_sales_summary WHERE branch_id = ? AND business_date = ?", (branch_id, day))
    db.insert("daily_sales_summary", {"org_id": actor.org_id, "branch_id": branch_id, "business_date": day, "gross": gross, "vat": vat,
                                      "food_net": food, "beverage_net": bev, "order_count": int(live.get("order_count") or 0),
                                      "void_count": int(voids["n"]), "void_amount": money(voids["amt"]), "z_number": z_no,
                                      "status": "CLOSED", "closed_by": actor.user_id, "closed_at": now_iso(), "source": "POS"})
    by = {r["payment_method_code"]: r for r in db.all("SELECT * FROM v_daily_payments WHERE branch_id = ? AND business_date = ?", (branch_id, day))}
    for code, r in by.items():
        db.insert("daily_sales_payment", {"branch_id": branch_id, "business_date": day, "payment_method_code": code,
                                          "amount": money(r["amount"]), "txn_count": int(r["txn_count"])})
    amt = lambda c: money(by[c]["amount"]) if c in by else Decimal(0)
    if not db.scalar("SELECT 1 FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (branch_id, day)):
        db.insert("cash_reconciliation", {"org_id": actor.org_id, "branch_id": branch_id, "business_date": day,
                                          "cash_expected": amt("CASH"), "telebirr_expected": amt("TELEBIRR"), "cbe_birr_expected": amt("CBE_BIRR")})
    z = {"date": day, "gross": str(gross), "vat": str(vat), "byMethod": {c: str(amt(c)) for c in ("CASH", "TELEBIRR", "CBE_BIRR")},
         "food": str(food), "beverage": str(bev), "zNumber": z_no}
    outbox(db, actor.org_id, branch_id, "fin.zreport", "closed", "daily_sales_summary", f"{branch_id}:{day}", z)
    audit(db, actor, "POS", "daily_sales_summary.close", "daily_sales_summary", f"{branch_id}:{day}",
          "Z-report #{z} closed: {gross} ETB", {"z": z_no, "gross": str(gross)}, branch_id=branch_id)
    return z


# ================================================================== SALES → MGR → FIN (purchasing)

def _vendor(db: Db, actor: Actor, vendor_id: str | None, vendor_name: str | None, cost_category: str) -> tuple[str, str]:
    if vendor_id:
        v = _get(db, "vendor", vendor_id, actor.org_id)
        return v["id"], v["name"]
    if not vendor_name:
        raise Invalid("vendor is required")
    v = db.one("SELECT id, name FROM vendor WHERE org_id = ? AND lower(name) = lower(CAST(? AS text)) AND deleted_at IS NULL", (actor.org_id, vendor_name.strip()))
    if v:
        return v["id"], v["name"]
    vid = new_id("ven")
    db.insert("vendor", {"id": vid, "org_id": actor.org_id, "name": vendor_name.strip(), "default_cost_category": cost_category})
    audit(db, actor, "SALES", "vendor.create", "vendor", vid, "New vendor {name} (no TIN yet)", {"name": vendor_name.strip()})
    return vid, vendor_name.strip()


def log_purchase(db: Db, actor: Actor, branch_id: str, item_id: str, quantity: Any, unit_cost: Any, *,
                 vendor_id: str | None = None, vendor_name: str | None = None, payment_method: str | None = "CASH",
                 settlement: str = "PAID_NOW", vat_amount: Any = 0, has_vat_receipt: bool = False, receipt_no: str | None = None,
                 note: str = "", client_ref: str | None = None, purchased_at: str | None = None,
                 id: str | None = None, unit: str | None = None, restock_request_id: str | None = None) -> dict:
    if client_ref:
        prev = db.one("SELECT * FROM purchase WHERE org_id = ? AND client_ref = ?", (actor.org_id, client_ref))
        if prev:
            return prev
    it = db.one("""SELECT i.*, m.cost_category_code FROM inventory_item i JOIN inventory_main_category m ON m.code = i.main_category_code
                   WHERE i.id = ? AND i.org_id = ? AND i.deleted_at IS NULL""", (item_id, actor.org_id))
    if not it:
        raise NotFound("inventory item not found", item_id=item_id)
    q, uc = D(quantity), money(unit_cost)
    if q <= 0:
        raise Invalid("quantity must be positive")
    if id and db.scalar("SELECT 1 FROM purchase WHERE id = ?", (id,)):
        return db.one("SELECT * FROM purchase WHERE id = ?", (id,))          # a retry of the same save
    unit_code = unit or it["unit_code"]
    if not db.scalar("SELECT 1 FROM unit WHERE code = ?", (unit_code,)):
        raise Invalid("unknown unit", unit=unit_code)
    vid, vname = _vendor(db, actor, vendor_id, vendor_name, it["cost_category_code"])
    at = purchased_at or now_iso()
    pid = id or new_id("pur")
    acc = account_for(db, actor.org_id, branch_id, payment_method) if settlement == "PAID_NOW" else None
    row = db.insert("purchase", {
        "id": pid, "org_id": actor.org_id, "branch_id": branch_id, "item_id": item_id, "cost_category_code": it["cost_category_code"],
        "quantity": q, "unit_code": unit_code, "unit_cost": uc, "total_cost": money(q * uc), "vat_amount": money(vat_amount),
        "has_vat_receipt": has_vat_receipt, "receipt_no": receipt_no, "vendor_id": vid, "vendor_name": vname, "settlement": settlement,
        "payment_method_code": payment_method if settlement == "PAID_NOW" else None, "money_account_id": acc, "note": note,
        "logged_by": actor.user_id, "purchased_at": at, "business_date": business_date(at), "client_ref": client_ref})
    if acc:  # the cash left when the clerk paid, whatever the review says later
        cash_move(db, actor, acc, -money(q * uc), "VENDOR", f"{vname}: {item_id}", "purchase", pid, on=business_date(at), branch_id=branch_id)
    outbox(db, actor.org_id, branch_id, "mgr.review", "created", "purchase", pid,
           {"entity": "purchase", "id": pid, "itemId": item_id, "totalCost": str(money(q * uc))})
    audit(db, actor, "SALES", "purchase.create", "purchase", pid, "Purchase {name} {quantity} {unit}",
          {"name": it["name_key"], "quantity": str(q), "unit": it["unit_code"], "amount": str(money(q * uc))}, branch_id=branch_id)
    link_restock(db, actor, branch_id, pid, item_id, restock_request_id)
    return db.one("SELECT * FROM purchase WHERE id = ?", (pid,))


# ---------- restock minimums: the low-stock alert fires at or below them ----------

def set_minimums(db: Db, actor: Actor, branch_id: str, items: list[dict]) -> list[dict]:
    """The manager sets the restock minimum (reorder point) of items at this branch. Any value from 0 up."""
    out = []
    for it in items:
        m = D(it.get("minimum"))
        if m < 0:
            raise Invalid("a minimum can't be below 0")
        row = db.one("SELECT id, name_key, unit_code FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
                     (it.get("itemId"), actor.org_id))
        if not row:
            raise NotFound("inventory item not found", item_id=it.get("itemId"))
        prev = db.scalar("SELECT reorder_point FROM branch_stock WHERE branch_id = ? AND item_id = ?", (branch_id, row["id"]))
        if prev is None:
            db.insert("branch_stock", {"org_id": actor.org_id, "branch_id": branch_id, "item_id": row["id"], "on_hand": 0, "reorder_point": m})
        else:
            if D(prev) == m:
                continue
            db.update("branch_stock", {"branch_id": branch_id, "item_id": row["id"]}, {"reorder_point": m, "updated_at": now_iso()})
        audit(db, actor, "MGR", "stock.minimum", "inventory_item", row["id"], "Restock minimum {name}: {before} → {after} {unit}",
              {"name": row["name_key"], "before": str(prev) if prev is not None else None, "after": str(m), "unit": row["unit_code"]},
              branch_id=branch_id)
        out.append({"itemId": row["id"], "minimum": float(m)})
    return out


# ---------- restock requests: Manager asks, the Purchases team buys ----------

RESTOCK_LIVE = ("OPEN", "ORDERED")


def request_restock(db: Db, actor: Actor, branch_id: str, items: list[dict], note: str | None = None) -> list[dict]:
    """One request per item. Asking again for an item that is still waiting updates that request instead of adding a second."""
    if not items:
        raise Invalid("pick at least one item")
    batch = new_id("rsb")
    out = []
    for it in items:
        q = D(it.get("quantity"))
        if q <= 0:
            raise Invalid("quantity must be positive")
        row = db.one("SELECT id, name_key, unit_code FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
                     (it.get("itemId"), actor.org_id))
        if not row:
            raise NotFound("inventory item not found", item_id=it.get("itemId"))
        line_note = (it.get("note") or note or "").strip() or None
        prev = db.one(f"""SELECT * FROM restock_request WHERE branch_id = ? AND item_id = ? AND status IN {RESTOCK_LIVE}
                          ORDER BY requested_at LIMIT 1""", (branch_id, row["id"]))
        if prev:
            db.update("restock_request", {"id": prev["id"]}, {"quantity": q, "note": line_note or prev["note"]})
            rid = prev["id"]
        else:
            rid = new_id("rst")
            db.insert("restock_request", {"id": rid, "org_id": actor.org_id, "branch_id": branch_id, "batch_id": batch,
                                          "item_id": row["id"], "quantity": q, "unit_code": row["unit_code"], "note": line_note,
                                          "status": "OPEN", "requested_by": actor.user_id, "requested_at": now_iso()})
        audit(db, actor, "MGR", "restock_request.create", "restock_request", rid, "Restock request {name} {quantity} {unit}",
              {"name": row["name_key"], "quantity": str(q), "unit": row["unit_code"]}, branch_id=branch_id)
        outbox(db, actor.org_id, branch_id, "restock", "created", "restock_request", rid, {"id": rid, "itemId": row["id"]})
        restock_refresh(db, rid)
        out.append(rid)
    return restock_list(db, branch_id, ids=out)


def update_restock(db: Db, actor: Actor, rid: str, action: str, reason: str | None = None) -> dict:
    r = _get(db, "restock_request", rid, actor.org_id)
    if action == "CANCEL":
        if r["status"] not in RESTOCK_LIVE:
            raise Conflict("this request is already closed", status=r["status"])
        db.update("restock_request", {"id": rid}, {"status": "CANCELLED", "done_at": now_iso()})
    elif action == "ORDERED":
        if r["status"] not in RESTOCK_LIVE:
            raise Conflict("this request is already closed", status=r["status"])
        db.update("restock_request", {"id": rid}, {"status": "ORDERED", "handled_by": actor.user_id, "handled_at": now_iso(), "reason": reason})
    elif action == "DECLINE":
        if r["status"] not in RESTOCK_LIVE:
            raise Conflict("this request is already closed", status=r["status"])
        if not (reason or "").strip():
            raise Invalid("say why it can't be bought")
        db.update("restock_request", {"id": rid}, {"status": "DECLINED", "handled_by": actor.user_id, "handled_at": now_iso(),
                                                   "reason": reason.strip(), "done_at": now_iso()})
    elif action == "REOPEN":
        if r["status"] not in ("DECLINED", "CANCELLED"):
            raise Conflict("only a declined or cancelled request can be reopened", status=r["status"])
        db.update("restock_request", {"id": rid}, {"status": "OPEN", "handled_by": None, "handled_at": None, "reason": None, "done_at": None})
    else:
        raise Invalid("unknown action", action=action)
    module = "MGR" if action in ("CANCEL", "REOPEN") else "SALES"
    audit(db, actor, module, f"restock_request.{action.lower()}", "restock_request", rid, "Restock request {status}",
          {"status": action, "reason": reason, "itemKey": r["item_id"]}, branch_id=r["branch_id"])
    outbox(db, actor.org_id, r["branch_id"], "restock", "updated", "restock_request", rid, {"id": rid, "action": action})
    return restock_list(db, r["branch_id"], ids=[rid])[0]


def link_restock(db: Db, actor: Actor, branch_id: str, purchase_id: str, item_id: str, restock_id: str | None) -> None:
    """A purchase fills the request it was bought for; with none named, the oldest waiting request for the same item."""
    rid = None
    if restock_id:
        rid = db.scalar(f"SELECT id FROM restock_request WHERE id = ? AND org_id = ? AND item_id = ? AND status IN {RESTOCK_LIVE}",
                        (restock_id, actor.org_id, item_id))
    if not rid:
        rid = db.scalar(f"""SELECT id FROM restock_request WHERE branch_id = ? AND item_id = ? AND status IN {RESTOCK_LIVE}
                            ORDER BY requested_at LIMIT 1""", (branch_id, item_id))
    if rid:
        db.update("purchase", {"id": purchase_id}, {"restock_request_id": rid})
        restock_refresh(db, rid)


def restock_refresh(db: Db, rid: str | None) -> None:
    """Recount what was bought for a request (deleted and rejected purchases don't count) and close it once it is covered."""
    if not rid:
        return
    r = db.one("SELECT * FROM restock_request WHERE id = ?", (rid,))
    if not r:
        return
    bought = Decimal(0)
    for p in db.all("""SELECT item_id, quantity, unit_code, unit_cost FROM purchase
                       WHERE restock_request_id = ? AND deleted_at IS NULL AND review_status <> 'REJECTED'""", (rid,)):
        q, _ = in_item_units(db, p["item_id"], D(p["quantity"]), p["unit_code"], D(p["unit_cost"]))
        bought += q
    st = r["status"]
    change: dict[str, Any] = {"bought_quantity": bought}
    if st in RESTOCK_LIVE and bought >= D(r["quantity"]):
        change |= {"status": "DONE", "done_at": now_iso()}
    elif st == "DONE" and bought < D(r["quantity"]):
        change |= {"status": "ORDERED" if r["handled_by"] else "OPEN", "done_at": None}
    db.update("restock_request", {"id": rid}, change)


def restock_list(db: Db, branch_id: str, *, days: int = 14, ids: list[str] | None = None) -> list[dict]:
    names = {u["id"]: u["full_name"] for u in db.all("SELECT id, full_name FROM app_user WHERE org_id = (SELECT org_id FROM branch WHERE id = ?)", (branch_id,))}
    if ids:
        rows = db.all(f"""SELECT r.*, i.name_key, i.custom_name FROM restock_request r JOIN inventory_item i ON i.id = r.item_id
                          WHERE r.id IN ({','.join('?' * len(ids))}) ORDER BY r.requested_at DESC""", ids)
    else:
        since = (date.today() - timedelta(days=days)).isoformat()
        rows = db.all(f"""SELECT r.*, i.name_key, i.custom_name FROM restock_request r JOIN inventory_item i ON i.id = r.item_id
                          WHERE r.branch_id = ? AND (r.status IN {RESTOCK_LIVE} OR r.requested_at >= ?)
                          ORDER BY r.requested_at DESC""", (branch_id, since))
    out = []
    for r in rows:
        out.append({"id": r["id"], "itemId": r["item_id"], "nameKey": r["name_key"], "name": r["custom_name"],
                    "quantity": float(r["quantity"]), "unit": r["unit_code"], "note": r["note"] or "", "status": r["status"],
                    "bought": float(r["bought_quantity"] or 0), "requestedBy": r["requested_by"],
                    "requestedByName": names.get(r["requested_by"], ""), "requestedAt": _iso(r["requested_at"]),
                    "handledBy": r["handled_by"], "handledByName": names.get(r["handled_by"], "") if r["handled_by"] else "",
                    "handledAt": _iso(r["handled_at"]), "reason": r["reason"] or "", "doneAt": _iso(r["done_at"])})
    return out


def in_item_units(db: Db, item_id: str, qty: Decimal, unit_code: str, unit_cost: Decimal) -> tuple[Decimal, Decimal]:
    """Quantity and unit cost expressed in the item's stock unit (same dimension only; else unchanged)."""
    item_unit = db.scalar("SELECT unit_code FROM inventory_item WHERE id = ?", (item_id,))
    if not item_unit or item_unit == unit_code:
        return qty, unit_cost
    a = db.one("SELECT dimension, to_base FROM unit WHERE code = ?", (unit_code,))
    b = db.one("SELECT dimension, to_base FROM unit WHERE code = ?", (item_unit,))
    if not a or not b or a["dimension"] != b["dimension"] or a["dimension"] == "COUNT":
        return qty, unit_cost
    factor = D(a["to_base"]) / D(b["to_base"])              # g → kg: 0.001
    return (qty * factor).quantize(Decimal("0.001")), (unit_cost / factor).quantize(Decimal("0.0001"))


def withholding_for(db: Db, org_id: str, vendor: dict, subtotal: Decimal, on: str) -> Decimal:
    """finance-main withholdingRate(): 0 below the threshold, 3 % with TIN, 30 % without."""
    code = "WHT_SERVICES" if vendor["supply_kind"] == "SERVICES" else "WHT_GOODS"
    rate, threshold = tax_rate(db, org_id, code, on)
    if threshold is not None and subtotal < threshold:
        return Decimal(0)
    if not vendor["tin_number"]:
        rate, _ = tax_rate(db, org_id, "WHT_NO_TIN", on)
    return rate


def review_purchase(db: Db, actor: Actor, purchase_id: str, decision: str, reason: str | None = None) -> dict:
    p = _get(db, "purchase", purchase_id, actor.org_id)
    if p["deleted_at"]:
        raise Conflict("purchase was deleted")
    if p["review_status"] not in ("PENDING", "FLAGGED"):
        raise Conflict("purchase already decided", status=p["review_status"])
    if decision in ("FLAG", "REJECT") and not reason:
        raise Invalid("a reason is required")
    status = {"APPROVE": "APPROVED", "FLAG": "FLAGGED", "REJECT": "REJECTED"}[decision]
    db.update("purchase", {"id": purchase_id}, {"review_status": status, "reviewed_by": actor.user_id, "reviewed_at": now_iso(),
                                                "flag_reason": reason if decision == "FLAG" else p["flag_reason"]})
    result: dict[str, Any] = {"purchaseId": purchase_id, "status": status, "warnings": []}
    if status == "APPROVED":
        qty, cost = in_item_units(db, p["item_id"], D(p["quantity"]), p["unit_code"], D(p["unit_cost"]))
        apply_stock(db, actor, p["branch_id"], p["item_id"], qty, "PURCHASE", cost, purchase_id=purchase_id)
        v = _get(db, "vendor", p["vendor_id"], actor.org_id)
        issue = str(p["business_date"])
        due = (date.fromisoformat(issue) + timedelta(days=0 if p["settlement"] == "PAID_NOW" else int(v["payment_terms_days"]))).isoformat()
        subtotal = money(p["total_cost"]) - money(p["vat_amount"])
        bill_no = p["receipt_no"] or f"PUR-{purchase_id[-8:]}"
        if db.scalar("SELECT 1 FROM bill WHERE vendor_id = ? AND bill_no = ?", (v["id"], bill_no)):
            bill_no = f"{bill_no}-{purchase_id[-4:]}"
        bid = new_id("bill")
        db.insert("bill", {"id": bid, "org_id": actor.org_id, "branch_id": p["branch_id"], "vendor_id": v["id"], "bill_no": bill_no,
                           "cost_category_code": p["cost_category_code"], "issue_date": issue, "due_date": due,
                           "description": f"Purchase {p['item_id']} × {p['quantity']} {p['unit_code']}", "subtotal": subtotal,
                           "vat": money(p["vat_amount"]), "has_vat_receipt": p["has_vat_receipt"], "source": "PURCHASE",
                           "entered_by": actor.user_id})
        db.insert("bill_line", {"id": new_id("bl"), "bill_id": bid, "purchase_id": purchase_id, "description": p["item_id"],
                                "cost_category_code": p["cost_category_code"], "quantity": p["quantity"], "unit_code": p["unit_code"],
                                "amount": subtotal, "vat": money(p["vat_amount"])})
        result["billId"] = bid
        if p["settlement"] == "PAID_NOW":
            rate = withholding_for(db, actor.org_id, v, subtotal, issue)
            if rate:
                result["warnings"].append(f"withholding of {rate * 100:.0f}% applies to this vendor/amount but the purchase was paid in full on the spot")
            db.insert("bill_payment", {"id": new_id("bp"), "bill_id": bid, "paid_on": issue, "amount": money(p["total_cost"]),
                                       "payment_method_code": p["payment_method_code"], "money_account_id": p["money_account_id"],
                                       "reference": "Paid at purchase", "paid_by": p["logged_by"]})
            db.update("bill", {"id": bid}, {"status": "PAID"})
        outbox(db, actor.org_id, p["branch_id"], "fin.payables", "created", "bill", bid, {"billId": bid, "source": "PURCHASE"})
    outbox(db, actor.org_id, p["branch_id"], "mgr.review", "decided", "purchase", purchase_id, {"entity": "purchase", "id": purchase_id, "status": status})
    audit(db, actor, "MGR", f"purchase.{decision.lower()}", "purchase", purchase_id, "Purchase {status}: {item}",
          {"status": status, "item": p["item_id"], "amount": str(p["total_cost"]), "reason": reason},
          before={"review_status": p["review_status"]}, after={"review_status": status}, branch_id=p["branch_id"])
    restock_refresh(db, p.get("restock_request_id"))
    return result


def pay_bill(db: Db, actor: Actor, bill_id: str, amount: Any, method: str, paid_on: str | None = None,
             reference: str | None = None, money_account_id: str | None = None, *, id: str | None = None) -> dict:
    if id and (done := db.one("SELECT * FROM bill_payment WHERE id = ?", (id,))):      # retry of the same payment
        return {"paymentId": id, "amount": str(done["amount"]), "withheld": str(done["withheld"]),
                "netPaid": str(money(done["amount"]) - money(done["withheld"])), "withholdingRate": str(done["withholding_rate"])}
    b = db.one("SELECT * FROM v_bill_status WHERE id = ? AND org_id = ?", (bill_id, actor.org_id))
    if not b:
        raise NotFound("bill not found")
    if b["display_status"] in ("PAID", "VOID", "DRAFT"):
        raise Conflict("bill is not payable", status=b["display_status"])
    amt, balance = money(amount), money(b["balance_due"])
    if amt <= 0 or amt > balance:
        raise Invalid("amount must be between 0 and the balance due", balance=str(balance))
    on = paid_on or business_date()
    v = _get(db, "vendor", b["vendor_id"], actor.org_id)
    rate = withholding_for(db, actor.org_id, v, money(b["subtotal"]), on)
    # withholding is on the pre-VAT value of what is settled
    withheld = money(amt * money(b["subtotal"]) / money(b["total"]) * rate) if rate else Decimal(0)
    acc = money_account_id or account_for(db, actor.org_id, None, method)
    pid = id or new_id("bp")
    db.insert("bill_payment", {"id": pid, "bill_id": bill_id, "paid_on": on, "amount": amt, "withholding_rate": rate, "withheld": withheld,
                               "payment_method_code": method, "money_account_id": acc, "reference": reference, "paid_by": actor.user_id})
    cash_move(db, actor, acc, -(amt - withheld), "VENDOR", f"{v['name']} {b['bill_no']}", "bill_payment", pid, on=on, branch_id=b["branch_id"])
    if amt == balance:
        db.update("bill", {"id": bill_id}, {"status": "PAID"})
    outbox(db, actor.org_id, b["branch_id"], "fin.payables", "paid", "bill", bill_id, {"billId": bill_id, "amount": str(amt)})
    audit(db, actor, "FIN", "bill.pay", "bill", bill_id, "Paid {vendor} {amount} ETB (withheld {withheld})",
          {"vendor": v["name"], "amount": str(amt), "withheld": str(withheld), "method": method})
    return {"paymentId": pid, "amount": str(amt), "withheld": str(withheld), "netPaid": str(amt - withheld), "withholdingRate": str(rate),
            "balanceDue": str(balance - amt)}


def undo_bill_payment(db: Db, actor: Actor, payment_id: str) -> dict:
    """Undo right after paying a bill (same person, within UNDO_WINDOW): the payment is removed and the money put back."""
    p = db.one("SELECT * FROM bill_payment WHERE id = ?", (payment_id,))
    if not p:
        raise NotFound("payment not found")
    b = _get(db, "bill", p["bill_id"], actor.org_id)
    if p["paid_by"] != actor.user_id:
        raise Conflict("only the person who made this payment can undo it")
    if datetime.now(timezone.utc) - _dt(p["created_at"]) >= UNDO_WINDOW:
        raise Conflict("this payment is more than 10 minutes old and can no longer be undone")
    net = money(p["amount"]) - money(p["withheld"])
    if p["money_account_id"]:
        cash_move(db, actor, p["money_account_id"], net, "VENDOR", f"Reversed payment {b['bill_no']}", "bill_payment", payment_id,
                  on=str(p["paid_on"]), branch_id=b["branch_id"])
    db.execute("DELETE FROM bill_payment WHERE id = ?", (payment_id,))
    if b["status"] == "PAID":
        db.update("bill", {"id": b["id"]}, {"status": "OPEN"})
    audit(db, actor, "FIN", "bill.unpay", "bill", b["id"], "Payment undone: {amount} ETB", {"amount": str(p["amount"])})
    return {"billId": b["id"], "paymentId": payment_id}


# ================================================================== waste, dispatch, expenses

def log_waste(db: Db, actor: Actor, branch_id: str, item_id: str, quantity: Any, reason: str, notes: str | None = None,
              reported_by: str | None = None, client_ref: str | None = None, *, id: str | None = None,
              unit_cost: Any = None, occurred_at: str | None = None) -> dict:
    r = db.one("SELECT * FROM waste_reason WHERE code = ?", (reason,))
    if not r:
        raise Invalid("unknown waste reason")
    if r["requires_note"] and not (notes or "").strip():
        raise Invalid("this reason needs a note", reason=reason)
    if id and db.scalar("SELECT 1 FROM waste_report WHERE id = ?", (id,)):
        return db.one("SELECT * FROM waste_report WHERE id = ?", (id,))
    it = _get(db, "inventory_item", item_id, actor.org_id)
    s = db.one("SELECT avg_unit_cost, last_unit_cost FROM branch_stock WHERE branch_id = ? AND item_id = ?", (branch_id, item_id)) or {}
    cost = money(unit_cost) if unit_cost is not None else money(s.get("avg_unit_cost") or s.get("last_unit_cost") or it["standard_unit_cost"])
    wid = id or new_id("wst")
    at = occurred_at or now_iso()
    db.insert("waste_report", {"id": wid, "org_id": actor.org_id, "branch_id": branch_id, "item_id": item_id, "quantity_lost": D(quantity),
                               "unit_code": it["unit_code"], "unit_cost": cost, "reason_code": reason, "notes": notes,
                               "reported_by": reported_by or actor.user_id, "logged_by": actor.user_id, "occurred_at": at,
                               "business_date": business_date(at), "client_ref": client_ref})
    outbox(db, actor.org_id, branch_id, "mgr.review", "created", "waste_report", wid, {"entity": "waste_report", "id": wid})
    audit(db, actor, "SALES", "waste_report.create", "waste_report", wid, "Waste {name}",
          {"name": it["name_key"], "quantity": str(quantity), "unit": it["unit_code"], "amount": str(money(D(quantity) * cost))}, branch_id=branch_id)
    return db.one("SELECT * FROM waste_report WHERE id = ?", (wid,))


def decide_waste(db: Db, actor: Actor, waste_id: str, approve: bool, reason: str | None = None) -> dict:
    w = _get(db, "waste_report", waste_id, actor.org_id)
    if w["approval_status"] != "PENDING":
        raise Conflict("already decided", status=w["approval_status"])
    reason = reason or (None if approve else "Rejected by manager")
    st = "APPROVED" if approve else "REJECTED"
    db.update("waste_report", {"id": waste_id}, {"approval_status": st, "decided_by": actor.user_id, "decided_at": now_iso(),
                                                 "rejection_reason": None if approve else reason})
    if approve:
        apply_stock(db, actor, w["branch_id"], w["item_id"], -D(w["quantity_lost"]), "WASTE", money(w["unit_cost"]), waste_id=waste_id)
    audit(db, actor, "MGR", f"waste_report.{'approve' if approve else 'reject'}", "waste_report", waste_id, "Waste {status}",
          {"status": st, "amount": str(w["loss_value"]), "reason": None if approve else reason}, branch_id=w["branch_id"])
    return db.one("SELECT * FROM waste_report WHERE id = ?", (waste_id,))


def branch_managers(db: Db, branch_id: str) -> list[dict]:
    """Who can approve this branch's dispatches: its branch managers (home branch, extra branch roles, or the branch's named manager)."""
    return db.all("""SELECT DISTINCT u.id, u.full_name FROM app_user u
                     LEFT JOIN user_branch_role r ON r.user_id = u.id AND r.branch_id = ?
                     WHERE u.org_id = (SELECT org_id FROM branch WHERE id = ?) AND u.is_active AND u.deleted_at IS NULL
                       AND (u.role_code = 'BRANCH_MANAGER' AND (u.home_branch_id = ? OR r.user_id IS NOT NULL)
                            OR u.id = (SELECT manager_user_id FROM branch WHERE id = ?))
                     ORDER BY u.full_name""", (branch_id, branch_id, branch_id, branch_id))


def request_dispatch(db: Db, actor: Actor, branch_id: str, item_id: str, quantity: Any, *, to_location: str | None = None,
                     to_branch_id: str | None = None, note: str | None = None, client_ref: str | None = None,
                     assigned_to: str | None = None) -> dict:
    """The Purchases team asks this branch's manager to let stock leave the store room (to the kitchen, bar, … or another branch)."""
    it = db.one("SELECT * FROM inventory_item WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (item_id, actor.org_id))
    if not it:
        raise NotFound("inventory item not found", item_id=item_id)
    q = D(quantity)
    if q <= 0:
        raise Invalid("quantity must be positive")
    if bool(to_location) == bool(to_branch_id):
        raise Invalid("choose one destination: a place in this branch or another branch")
    loc = None
    if to_location:
        loc = db.scalar("SELECT id FROM stock_location WHERE branch_id = ? AND code = ? AND NOT is_store_room", (branch_id, to_location))
        if not loc:
            raise Invalid("unknown destination", to_location=to_location)
    if to_branch_id:
        if to_branch_id == branch_id:
            raise Invalid("a transfer must go to another branch")
        if not db.scalar("SELECT 1 FROM branch WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (to_branch_id, actor.org_id)):
            raise Invalid("unknown branch", to_branch_id=to_branch_id)
    managers = {m["id"] for m in branch_managers(db, branch_id)}
    if assigned_to and assigned_to not in managers:
        raise Invalid("choose a manager of this branch", assigned_to=assigned_to)
    if not assigned_to and len(managers) == 1:
        assigned_to = next(iter(managers))
    if client_ref:
        prev = db.one("SELECT * FROM dispatch_request WHERE org_id = ? AND client_ref = ?", (actor.org_id, client_ref))
        if prev:
            return prev
    did = new_id("dsp")
    text = (note or "").strip()
    db.insert("dispatch_request", {"id": did, "org_id": actor.org_id, "branch_id": branch_id, "item_id": item_id, "quantity": q,
                                   "unit_code": it["unit_code"], "to_location_id": loc, "to_branch_id": to_branch_id,
                                   "requested_by": actor.user_id, "note": text or None, "client_ref": client_ref,
                                   "assigned_to": assigned_to})
    outbox(db, actor.org_id, branch_id, "mgr.review", "created", "dispatch_request", did,
           {"entity": "dispatch_request", "id": did, "assignedTo": assigned_to})
    audit(db, actor, "SALES", "dispatch_request.create", "dispatch_request", did, "Dispatch request {name} {quantity}",
          {"name": it["name_key"], "quantity": str(q), "unit": it["unit_code"], "destination": to_location or "BRANCH"}, branch_id=branch_id)
    return db.one("SELECT * FROM dispatch_request WHERE id = ?", (did,))


def cancel_dispatch(db: Db, actor: Actor, dispatch_id: str) -> dict:
    """The person who sent a dispatch request takes it back while the manager hasn't decided."""
    d = _get(db, "dispatch_request", dispatch_id, actor.org_id)
    if d["status"] != "PENDING":
        raise Conflict("the manager already decided", status=d["status"])
    if d["requested_by"] != actor.user_id:
        raise ServiceError("only the person who sent it can cancel it")
    db.update("dispatch_request", {"id": dispatch_id}, {"status": "CANCELLED"})
    outbox(db, actor.org_id, d["branch_id"], "mgr.review", "cancelled", "dispatch_request", dispatch_id, {"entity": "dispatch_request", "id": dispatch_id})
    audit(db, actor, "SALES", "dispatch_request.cancel", "dispatch_request", dispatch_id, "Dispatch request cancelled", {}, branch_id=d["branch_id"])
    return db.one("SELECT * FROM dispatch_request WHERE id = ?", (dispatch_id,))


def dispatch_list(db: Db, branch_id: str, since: str, *, requested_by: str | None = None) -> list[dict]:
    """Dispatch requests of a branch, shaped for the Manager and Purchases apps."""
    names = {u["id"]: u["full_name"] for u in db.all("SELECT id, full_name FROM app_user WHERE org_id = (SELECT org_id FROM branch WHERE id = ?)", (branch_id,))}
    rows = db.all("""SELECT d.*, i.name_key, i.custom_name, l.code AS dest, b.name AS to_branch_name
                     FROM dispatch_request d JOIN inventory_item i ON i.id = d.item_id
                     LEFT JOIN stock_location l ON l.id = d.to_location_id LEFT JOIN branch b ON b.id = d.to_branch_id
                     WHERE d.branch_id = ? AND (d.requested_at >= ? OR d.status = 'PENDING') AND d.status <> 'CANCELLED'
                       AND (CAST(? AS text) IS NULL OR d.requested_by = ?)
                     ORDER BY d.requested_at DESC""", (branch_id, since, requested_by, requested_by))
    out = []
    for r in rows:
        note = r["note"] or ""
        out.append({"id": r["id"], "itemId": r["item_id"], "itemName": r["name_key"], "name": r["custom_name"], "quantity": float(r["quantity"]),
                    "unit": r["unit_code"], "requestedBy": r["requested_by"], "requestedByName": names.get(r["requested_by"], ""),
                    "status": "APPROVED" if r["status"] == "RECEIVED" else r["status"],
                    "destination": r["dest"] or ("BRANCH_PIASSA" if r["to_branch_id"] else "KITCHEN_LINE"),
                    **({"toBranchId": r["to_branch_id"], "toBranchName": r["to_branch_name"]} if r["to_branch_id"] else {}),
                    "timestamp": _iso(r["requested_at"]), **({"note": note} if note else {}),
                    **({"rejectionReason": r["rejection_reason"]} if r["rejection_reason"] else {}),
                    **({"assignedTo": r["assigned_to"], "assignedToName": names.get(r["assigned_to"], "")} if r.get("assigned_to") else {}),
                    **({"approvedBy": r["decided_by"], "approvedByName": names.get(r["decided_by"], ""), "decidedAt": _iso(r["decided_at"])}
                       if r["decided_by"] else {})})
    return out


def decide_dispatch(db: Db, actor: Actor, dispatch_id: str, approve: bool, reason: str | None = None) -> dict:
    d = _get(db, "dispatch_request", dispatch_id, actor.org_id)
    if d["status"] != "PENDING":
        raise Conflict("already decided", status=d["status"])
    if actor.role not in ("BRANCH_MANAGER", "ADMIN", "OWNER"):
        raise ServiceError("only the branch manager decides dispatch requests")
    if not approve and not reason:
        raise Invalid("a rejection needs a reason")
    st = "APPROVED" if approve else "REJECTED"
    settled: list[str] = []
    if approve:
        # Dispatching is the manager's decision on the stock: purchases of this item still waiting for review are
        # approved with it (the stock arrives, then leaves), so nothing stays pending in Purchases (COGS) or the Owner app.
        for pr in db.all("""SELECT id FROM purchase WHERE branch_id = ? AND item_id = ? AND review_status = 'PENDING'
                            AND deleted_at IS NULL ORDER BY purchased_at""", (d["branch_id"], d["item_id"])):
            review_purchase(db, actor, pr["id"], "APPROVE")
            settled.append(pr["id"])
        apply_stock(db, actor, d["branch_id"], d["item_id"], -D(d["quantity"]),
                    "TRANSFER_OUT" if d["to_branch_id"] else "DISPATCH", allow_negative=False, dispatch_id=dispatch_id)
    db.update("dispatch_request", {"id": dispatch_id}, {"status": st, "decided_by": actor.user_id, "decided_at": now_iso(),
                                                        "rejection_reason": None if approve else reason})
    audit(db, actor, "MGR", f"dispatch_request.{'approve' if approve else 'reject'}", "dispatch_request", dispatch_id,
          "Dispatch {status}", {"status": st, "reason": reason, "purchasesApproved": len(settled)}, branch_id=d["branch_id"])
    outbox(db, actor.org_id, d["branch_id"], "mgr.review", "decided", "dispatch_request", dispatch_id,
           {"entity": "dispatch_request", "id": dispatch_id, "status": st})
    return {**db.one("SELECT * FROM dispatch_request WHERE id = ?", (dispatch_id,)), "approvedPurchases": settled}


def receive_transfer(db: Db, actor: Actor, dispatch_id: str) -> dict:
    d = _get(db, "dispatch_request", dispatch_id, actor.org_id)
    if d["status"] != "APPROVED" or not d["to_branch_id"]:
        raise Conflict("not an approved transfer")
    cost = db.scalar("SELECT avg_unit_cost FROM branch_stock WHERE branch_id = ? AND item_id = ?", (d["branch_id"], d["item_id"]))
    apply_stock(db, actor, d["to_branch_id"], d["item_id"], D(d["quantity"]), "TRANSFER_IN", D(cost) if cost else None, dispatch_id=dispatch_id)
    db.update("dispatch_request", {"id": dispatch_id}, {"status": "RECEIVED", "received_by": actor.user_id, "received_at": now_iso()})
    audit(db, actor, "MGR", "dispatch_request.receive", "dispatch_request", dispatch_id, "Transfer received", {}, branch_id=d["to_branch_id"])
    return db.one("SELECT * FROM dispatch_request WHERE id = ?", (dispatch_id,))


def log_expense(db: Db, actor: Actor, branch_id: str, reason: str, tag: str, amount: Any, method: str, *,
                petty_cash: bool = False, note: str = "", client_ref: str | None = None, module: str = "SALES",
                id: str | None = None, spent_at: str | None = None) -> dict:
    cat = db.scalar("SELECT cost_category_code FROM expense_tag WHERE code = ?", (tag,))
    if not cat:
        raise Invalid("unknown expense tag")
    if id and db.scalar("SELECT 1 FROM expense WHERE id = ?", (id,)):
        return db.one("SELECT * FROM expense WHERE id = ?", (id,))
    acc = (db.scalar("SELECT id FROM money_account WHERE branch_id = ? AND kind = 'PETTY_CASH'", (branch_id,))
           if petty_cash else account_for(db, actor.org_id, branch_id, method))
    eid = id or new_id("exp")
    at = spent_at or now_iso()
    db.insert("expense", {"id": eid, "org_id": actor.org_id, "branch_id": branch_id, "reason": reason, "tag_code": tag,
                          "cost_category_code": cat, "amount": money(amount), "payment_method_code": method, "money_account_id": acc,
                          "note": note, "logged_by": actor.user_id, "spent_at": at, "business_date": business_date(at), "client_ref": client_ref,
                          "review_status": "APPROVED" if actor.role in ("BRANCH_MANAGER", "ADMIN") else "PENDING"})
    cash_move(db, actor, acc, -money(amount), "EXPENSE", reason, "expense", eid, on=business_date(at), branch_id=branch_id)
    audit(db, actor, module, "expense.create", "expense", eid, "Expense {reason}", {"reason": reason, "amount": str(money(amount))}, branch_id=branch_id)
    return db.one("SELECT * FROM expense WHERE id = ?", (eid,))


# ---- delete & restore (Sales app: managers delete; staff may undo their own fresh, undecided entry)

UNDO_WINDOW = timedelta(minutes=10)
_RECORDS = {
    "purchase": ("purchase", "review_status", "total_cost", "VENDOR", "purchased_at"),
    "waste_report": ("waste_report", "approval_status", None, None, "occurred_at"),
    "expense": ("expense", "review_status", "amount", "EXPENSE", "spent_at"),
}


def delete_record(db: Db, actor: Actor, entity: str, record_id: str, can_manage: bool) -> dict:
    table, status_col, amount_col, cash_kind, _ = _RECORDS[entity]
    r = _get(db, table, record_id, actor.org_id)
    if r["deleted_at"]:
        return r
    own_fresh = r["logged_by"] == actor.user_id and datetime.now(timezone.utc) - _dt(r["created_at"]) < UNDO_WINDOW
    if not (can_manage or own_fresh):
        raise ServiceError("only a manager can delete a saved entry")
    if entity == "purchase" and r[status_col] == "APPROVED":
        raise Conflict("this purchase is approved and billed; correct it in Finance instead")
    if entity == "waste_report" and r[status_col] != "PENDING":
        raise Conflict("this waste report was already decided")
    db.update(table, {"id": record_id}, {"deleted_at": now_iso(), "deleted_by": actor.user_id})
    if amount_col and r.get("money_account_id") and (entity == "expense" or r.get("settlement") == "PAID_NOW"):
        cash_move(db, actor, r["money_account_id"], money(r[amount_col]), cash_kind, f"Reversed: deleted {entity}",
                  entity, record_id, on=str(r["business_date"]), branch_id=r["branch_id"])
    audit(db, actor, "SALES", f"{entity}.delete", entity, record_id, f"Deleted {entity.replace('_report', '')}",
          {"amount": str(r[amount_col]) if amount_col else str(r.get("loss_value"))}, branch_id=r["branch_id"])
    if entity == "purchase":
        restock_refresh(db, r.get("restock_request_id"))
    return db.one(f"SELECT * FROM {table} WHERE id = ?", (record_id,))


def restore_record(db: Db, actor: Actor, entity: str, record_id: str, can_manage: bool) -> dict:
    table, _, amount_col, cash_kind, _ = _RECORDS[entity]
    r = _get(db, table, record_id, actor.org_id)
    if not r["deleted_at"]:
        return r
    if not (can_manage or r["deleted_by"] == actor.user_id):
        raise ServiceError("only a manager can restore this entry")
    db.update(table, {"id": record_id}, {"deleted_at": None, "deleted_by": None})
    if amount_col and r.get("money_account_id") and (entity == "expense" or r.get("settlement") == "PAID_NOW"):
        cash_move(db, actor, r["money_account_id"], -money(r[amount_col]), cash_kind, f"Restored {entity}",
                  entity, record_id, on=str(r["business_date"]), branch_id=r["branch_id"])
    audit(db, actor, "SALES", f"{entity}.restore", entity, record_id, f"Restored {entity.replace('_report', '')}", {}, branch_id=r["branch_id"])
    if entity == "purchase":
        restock_refresh(db, r.get("restock_request_id"))
    return db.one(f"SELECT * FROM {table} WHERE id = ?", (record_id,))


def undo_decision(db: Db, actor: Actor, entity: str, record_id: str) -> dict:
    """The manager's Undo right after a decision: puts a purchase review, dispatch decision or waste decision
    back to PENDING and reverses its stock (and the bill an approved purchase created). Only the person who
    decided, within UNDO_WINDOW."""
    table, status_col, by_col, at_col = {
        "purchase": ("purchase", "review_status", "reviewed_by", "reviewed_at"),
        "dispatch_request": ("dispatch_request", "status", "decided_by", "decided_at"),
        "waste_report": ("waste_report", "approval_status", "decided_by", "decided_at"),
    }[entity]
    r = _get(db, table, record_id, actor.org_id)
    status = r[status_col]
    if status == "PENDING":
        return r
    if r[by_col] != actor.user_id:
        raise Conflict("only the manager who made this decision can undo it")
    if not r[at_col] or datetime.now(timezone.utc) - _dt(r[at_col]) >= UNDO_WINDOW:
        raise Conflict("this decision is more than 10 minutes old and can no longer be undone")
    if entity == "purchase" and status == "APPROVED":
        bills = db.all("SELECT DISTINCT b.id FROM bill b JOIN bill_line l ON l.bill_id = b.id WHERE l.purchase_id = ? AND b.status <> 'VOID'", (record_id,))
        for b in bills:
            if db.scalar("SELECT 1 FROM bill_payment WHERE bill_id = ? AND reference <> 'Paid at purchase'", (b["id"],)):
                raise Conflict("Finance already paid this bill; correct it in Finance instead")
            db.execute("DELETE FROM bill_payment WHERE bill_id = ?", (b["id"],))
            db.update("bill", {"id": b["id"]}, {"status": "VOID"})
        qty, _ = in_item_units(db, r["item_id"], D(r["quantity"]), r["unit_code"], D(r["unit_cost"]))
        apply_stock(db, actor, r["branch_id"], r["item_id"], -qty, "PURCHASE", purchase_id=record_id)
        db.update(table, {"id": record_id}, {"review_status": "PENDING", "reviewed_by": None, "reviewed_at": None, "flag_reason": None})
    elif entity == "purchase":
        db.update(table, {"id": record_id}, {"review_status": "PENDING", "reviewed_by": None, "reviewed_at": None, "flag_reason": None})
    elif entity == "dispatch_request":
        if status not in ("APPROVED", "REJECTED"):
            raise Conflict("this transfer was already received")
        if status == "APPROVED":
            apply_stock(db, actor, r["branch_id"], r["item_id"], D(r["quantity"]), "TRANSFER_OUT" if r["to_branch_id"] else "DISPATCH",
                        dispatch_id=record_id)
        db.update(table, {"id": record_id}, {"status": "PENDING", "decided_by": None, "decided_at": None, "rejection_reason": None})
    else:
        if status == "APPROVED":
            apply_stock(db, actor, r["branch_id"], r["item_id"], D(r["quantity_lost"]), "WASTE", waste_id=record_id)
        db.update(table, {"id": record_id}, {"approval_status": "PENDING", "decided_by": None, "decided_at": None, "rejection_reason": None})
    outbox(db, actor.org_id, r["branch_id"], "mgr.review", "reopened", entity, record_id, {"entity": entity, "id": record_id, "status": "PENDING"})
    audit(db, actor, "MGR", f"{entity}.undo", entity, record_id, "Undid {status} decision", {"status": status},
          before={status_col: status}, after={status_col: "PENDING"}, branch_id=r["branch_id"])
    if entity == "purchase":
        restock_refresh(db, r.get("restock_request_id"))
    return db.one(f"SELECT * FROM {table} WHERE id = ?", (record_id,))


# ================================================================== HR → FIN

def _local(dt: datetime) -> datetime:
    return dt.astimezone(ADDIS)


def clock_in(db: Db, actor: Actor, employee_id: str, at: str | None = None, device_id: str | None = None) -> dict:
    at_dt = _dt(at or now_iso())
    day = _local(at_dt).date().isoformat()
    emp = db.one("SELECT e.*, u.home_branch_id FROM employee e JOIN app_user u ON u.id = e.user_id WHERE e.user_id = ? AND e.org_id = ?", (employee_id, actor.org_id))
    if not emp or emp["status"] != "ACTIVE":
        raise Invalid("not an active employee")
    if db.scalar("SELECT 1 FROM attendance_record WHERE employee_id = ? AND status = 'CLOCKED_IN'", (employee_id,)):
        raise Conflict("already clocked in")
    sched = db.all("SELECT * FROM schedule_entry WHERE employee_id = ? AND work_date = ? AND status <> 'CANCELLED'", (employee_id, day))
    tmpl = {r["code"]: r for r in db.all("SELECT * FROM shift_template WHERE org_id = ? AND branch_id IS NULL", (actor.org_id,))}

    def window(code: str) -> tuple[datetime, datetime]:
        t = tmpl[code]
        s = datetime.fromisoformat(f"{day}T{str(t['start_time'])[:5]}").replace(tzinfo=ADDIS)
        e = datetime.fromisoformat(f"{day}T{str(t['end_time'])[:5]}").replace(tzinfo=ADDIS)
        return s, e + (timedelta(days=1) if e <= s else timedelta())

    if sched:   # the planned shift whose start is closest to now
        entry = min(sched, key=lambda s: abs((window(s["shift_code"])[0] - at_dt).total_seconds()))
        code, branch = entry["shift_code"], entry["branch_id"]
    else:
        entry, branch = None, emp["home_branch_id"]
        code = min(tmpl, key=lambda c: abs((window(c)[0] - at_dt).total_seconds()))
    s, e = window(code)
    late = int((at_dt - s).total_seconds() // 60)
    late = late if late > LATE_GRACE_MIN else 0
    existing = db.one("SELECT id FROM attendance_record WHERE employee_id = ? AND work_date = ? AND shift_code = ?", (employee_id, day, code))
    row = {"clock_in": at_dt.astimezone(timezone.utc).isoformat(), "status": "CLOCKED_IN", "late_minutes": late,
           "clock_method": "PIN" if actor.user_id == employee_id else "MANAGER", "device_id": device_id, "logged_by": actor.user_id}
    if existing:
        db.update("attendance_record", {"id": existing["id"]}, row)
        aid = existing["id"]
    else:
        aid = new_id("att")
        db.insert("attendance_record", {"id": aid, "org_id": actor.org_id, "branch_id": branch, "employee_id": employee_id,
                                        "schedule_entry_id": entry["id"] if entry else None, "work_date": day, "shift_code": code,
                                        "scheduled_start": s.astimezone(timezone.utc).isoformat(),
                                        "scheduled_end": e.astimezone(timezone.utc).isoformat(), **row})
    if late:
        db.insert("performance_log", {"id": new_id("pl"), "org_id": actor.org_id, "employee_id": employee_id, "branch_id": branch,
                                      "log_type": "LATENESS", "severity": "LOW" if late < 30 else "MEDIUM",
                                      "note": f"Clocked in {late} min late for {code}", "source": "SYSTEM",
                                      "ref_type": "attendance_record", "ref_id": aid, "logged_by": actor.user_id})
    audit(db, actor, "HR", "attendance.clock_in", "attendance_record", aid, "Clock-in {shift} ({late} min late)",
          {"shift": code, "late": late}, branch_id=branch)
    return db.one("SELECT * FROM attendance_record WHERE id = ?", (aid,))


def _worked_hours(db: Db, rec: dict) -> Decimal:
    if not rec["clock_in"]:
        return Decimal(0)
    end = _dt(rec["clock_out"]) if rec["clock_out"] else datetime.now(timezone.utc)
    secs = (end - _dt(rec["clock_in"])).total_seconds()
    for b in db.all("SELECT start_at, end_at FROM attendance_break WHERE attendance_id = ? AND NOT is_paid", (rec["id"],)):
        secs -= ((_dt(b["end_at"]) if b["end_at"] else end) - _dt(b["start_at"])).total_seconds()
    return max(Decimal(0), Decimal(str(secs)) / 3600)


def clock_out(db: Db, actor: Actor, employee_id: str, at: str | None = None) -> dict:
    rec = db.one("SELECT * FROM attendance_record WHERE employee_id = ? AND status = 'CLOCKED_IN' AND org_id = ?", (employee_id, actor.org_id))
    if not rec:
        raise Conflict("not clocked in")
    at_dt = _dt(at or now_iso())
    db.execute("UPDATE attendance_break SET end_at = ? WHERE attendance_id = ? AND end_at IS NULL", (at_dt.isoformat(), rec["id"]))
    rec["clock_out"] = at_dt.isoformat()
    worked = _worked_hours(db, rec)
    planned = Decimal(str((_dt(rec["scheduled_end"]) - _dt(rec["scheduled_start"])).total_seconds())) / 3600
    ot = max(Decimal(0), worked - planned).quantize(Decimal("0.01"))
    local_day = date.fromisoformat(str(rec["work_date"]))
    mult = Decimal("2.0") if local_day.weekday() == 6 else (Decimal("1.75") if _local(at_dt).hour >= 22 else Decimal("1.5"))
    db.update("attendance_record", {"id": rec["id"]}, {"clock_out": at_dt.astimezone(timezone.utc).isoformat(), "status": "COMPLETED",
                                                       "overtime_hours": ot, "overtime_multiplier": mult})
    audit(db, actor, "HR", "attendance.clock_out", "attendance_record", rec["id"], "Clock-out ({hours} h, {ot} h overtime)",
          {"hours": f"{worked:.2f}", "ot": str(ot)}, branch_id=rec["branch_id"])
    return db.one("SELECT * FROM attendance_record WHERE id = ?", (rec["id"],))


def income_tax(db: Db, monthly_taxable: Decimal, on: str) -> Decimal:
    rows = db.all("""SELECT upper_limit, rate, deduction FROM paye_bracket WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
                     ORDER BY upper_limit IS NULL, upper_limit""", (on, on))
    for r in rows:
        if r["upper_limit"] is None or monthly_taxable <= D(r["upper_limit"]):
            return max(Decimal(0), money(monthly_taxable * D(r["rate"]) - D(r["deduction"])))
    return Decimal(0)


def payslip(db: Db, emp: dict, month: str, today: str | None = None) -> dict:
    """Port of HR-main store.ts payslip() — same numbers as the HR screen."""
    y, m = map(int, month.split("-"))
    first, last = f"{month}-01", f"{month}-{calendar.monthrange(y, m)[1]:02d}"
    today = today or business_date()
    to = last if last < today else today
    recs = db.all("""SELECT * FROM attendance_record WHERE employee_id = ? AND status = 'COMPLETED' AND work_date >= ? AND work_date <= ?""",
                  (emp["user_id"], first, to))
    regular = ot = ot_pay = Decimal(0)
    rate = D(emp["hourly_rate"])
    for a in recs:
        regular += min(_worked_hours(db, a), NORMAL_DAY_HOURS)
        ot += D(a["overtime_hours"])
        ot_pay += D(a["overtime_hours"]) * rate * D(a["overtime_multiplier"])
    prorated = to < last
    days_in_month, days_so_far = int(last[-2:]), int(to[-2:])
    hire = str(emp["hire_date"])
    start_day = int(hire[-2:]) if hire > first else 1
    employed = 0 if hire > to else max(0, days_so_far - start_day + 1)
    if emp["pay_type"] == "MONTHLY":
        salary = D(emp["monthly_salary"]) if emp["monthly_salary"] is not None else rate * MONTH_HOURS
        base = salary * (Decimal(employed) / days_in_month if (prorated or start_day > 1) else 1)
    else:
        base = regular * rate
    gross = base + ot_pay
    scale = Decimal(days_in_month) / days_so_far if prorated else Decimal(1)
    tax = income_tax(db, gross * scale, to) / scale
    pen_e = base * Decimal("0.07")
    return {"employee_id": emp["user_id"], "regular_hours": money(regular), "overtime_hours": money(ot), "base_pay": money(base),
            "overtime_pay": money(ot_pay), "gross_taxable": money(gross), "income_tax": money(tax), "pension_employee": money(pen_e),
            "pension_employer": money(base * Decimal("0.11")), "net_pay": money(gross - tax - pen_e), "prorated": prorated}


def calculate_payroll(db: Db, actor: Actor, month: str, branch_id: str | None = None, today: str | None = None) -> dict:
    period = f"{month}-01"
    run = db.one("SELECT * FROM payroll_run WHERE org_id = ? AND period_month = ? AND coalesce(branch_id, '-') = ? AND status <> 'VOID'",
                 (actor.org_id, period, branch_id or "-"))
    if run and run["status"] != "DRAFT":
        raise Conflict("payroll already approved", status=run["status"])
    if not run:
        run = {"id": new_id("pr")}
        db.insert("payroll_run", {"id": run["id"], "org_id": actor.org_id, "branch_id": branch_id, "period_month": period})
    db.execute("DELETE FROM payslip WHERE payroll_run_id = ?", (run["id"],))
    emps = db.all("""SELECT e.*, u.home_branch_id FROM employee e JOIN app_user u ON u.id = e.user_id
                     WHERE e.org_id = ? AND e.status = 'ACTIVE' AND (CAST(? AS text) IS NULL OR u.home_branch_id = ?)""", (actor.org_id, branch_id, branch_id))
    tot = {k: Decimal(0) for k in ("gross_taxable", "income_tax", "pension_employee", "pension_employer", "net_pay")}
    for e in emps:
        ps = payslip(db, e, month, today)
        db.insert("payslip", {"id": new_id("ps"), "payroll_run_id": run["id"], "branch_id": e["home_branch_id"], **ps})
        for k in tot:
            tot[k] += ps[k]
    db.update("payroll_run", {"id": run["id"]}, {"total_gross": tot["gross_taxable"], "total_income_tax": tot["income_tax"],
                                                 "total_pension_employee": tot["pension_employee"],
                                                 "total_pension_employer": tot["pension_employer"], "total_net": tot["net_pay"]})
    audit(db, actor, "HR", "payroll_run.calculate", "payroll_run", run["id"], "Payroll {month} calculated for {n} staff",
          {"month": month, "n": len(emps), "gross": str(tot["gross_taxable"])})
    return db.one("SELECT * FROM payroll_run WHERE id = ?", (run["id"],))


def approve_payroll(db: Db, actor: Actor, run_id: str) -> dict:
    r = _get(db, "payroll_run", run_id, actor.org_id)
    if r["status"] != "DRAFT":
        raise Conflict("not a draft", status=r["status"])
    db.update("payroll_run", {"id": run_id}, {"status": "APPROVED", "approved_by": actor.user_id, "approved_at": now_iso()})
    outbox(db, actor.org_id, r["branch_id"], "fin.payroll", "approved", "payroll_run", run_id,
           {"month": str(r["period_month"])[:7], "gross": str(r["total_gross"]), "employerPension": str(r["total_pension_employer"])})
    audit(db, actor, "HR", "payroll_run.approve", "payroll_run", run_id, "Payroll {month} approved", {"month": str(r["period_month"])[:7]})
    return db.one("SELECT * FROM payroll_run WHERE id = ?", (run_id,))


def pay_payroll(db: Db, actor: Actor, run_id: str, money_account_id: str, paid_on: str | None = None) -> dict:
    """Net pay leaves the bank now; PAYE and pension become open tax filings for Finance."""
    r = _get(db, "payroll_run", run_id, actor.org_id)
    if r["status"] != "APPROVED":
        raise Conflict("approve the payroll first", status=r["status"])
    on = paid_on or business_date()
    db.update("payroll_run", {"id": run_id}, {"status": "PAID", "paid_on": on, "paid_from_account_id": money_account_id})
    cash_move(db, actor, money_account_id, -money(r["total_net"]), "PAYROLL", f"Net pay {str(r['period_month'])[:7]}", "payroll_run", run_id, on=on)
    period = str(r["period_month"])[:10]
    for kind, amt in (("PAYE", money(r["total_income_tax"])),
                      ("PENSION", money(r["total_pension_employee"]) + money(r["total_pension_employer"]))):
        ex = db.one("SELECT id, amount_due FROM tax_filing WHERE org_id = ? AND kind = ? AND period_month = ?", (actor.org_id, kind, period))
        if ex:
            db.update("tax_filing", {"id": ex["id"]}, {"amount_due": money(ex["amount_due"]) + amt})
        else:
            db.insert("tax_filing", {"id": new_id("tax"), "org_id": actor.org_id, "period_month": period, "kind": kind, "amount_due": amt})
    audit(db, actor, "FIN", "payroll_run.pay", "payroll_run", run_id, "Payroll {month} paid", {"month": period[:7], "net": str(r["total_net"])})
    return db.one("SELECT * FROM payroll_run WHERE id = ?", (run_id,))
