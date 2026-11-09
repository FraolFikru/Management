"""Branch Manager (managgerr-main): overview, review queues, sales & payment reconciliation, audit."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .. import services as s
from . import Db, Depends, Principal, branch_of, get_db, period_range, require

router = APIRouter(prefix="/manager", tags=["manager"])


class Review(BaseModel):
    decision: Literal["APPROVE", "FLAG", "REJECT"]
    reason: str | None = None


class Decision(BaseModel):
    approve: bool
    reason: str | None = None


class UndoIn(BaseModel):
    entity: Literal["purchase", "dispatch_request", "waste_report"]
    id: str


@router.post("/undo")
def undo(body: UndoIn, p: Principal = Depends(require("purchase.review", "waste.approve", "dispatch.approve")), db: Db = Depends(get_db)):
    """Undo right after a decision (same manager, within 10 minutes)."""
    with db.tx():
        return s.undo_decision(db, p.actor, body.entity, body.id)


# ---------- one call that fills the Manager app (same shapes as managgerr-main types.ts) ----------

MGR_ROLE = {"ADMIN": "ADMIN", "OWNER": "ADMIN", "BRANCH_MANAGER": "BRANCH_MANAGER"}
STAFF_ROLE = {"ADMIN": "ADMIN", "OWNER": "ADMIN", "BRANCH_MANAGER": "BRANCH_MANAGER", "INVENTORY_CLERK": "INVENTORY_CLERK"}
_REVIEW = {"PENDING": "PENDING", "APPROVED": "APPROVED", "FLAGGED": "FLAGGED", "REJECTED": "FLAGGED"}
_PAY = ("CASH", "TELEBIRR", "CBE_BIRR")
_MGR_ACTION = {"purchase.approve": "APPROVE_PURCHASE", "purchase.flag": "FLAG_PURCHASE", "purchase.reject": "FLAG_PURCHASE",
               "dispatch_request.approve": "APPROVE_DISPATCH", "dispatch_request.reject": "REJECT_DISPATCH",
               "waste_report.create": "LOG_WASTE", "waste_report.approve": "LOG_WASTE", "waste_report.reject": "LOG_WASTE",
               "expense.create": "LOG_EXPENSE", "auth.sign_in": "SWITCH_USER"}


def _f(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


@router.get("/bootstrap")
def manager_bootstrap(days: int = 31, p: Principal = Depends(require("mgr.dashboard")), db: Db = Depends(get_db)):
    br, org = branch_of(p), p.actor.org_id
    since = (date.today() - timedelta(days=days)).isoformat()
    iso = s._iso
    staff = [{"userId": u["id"], "name": u["full_name"], "role": STAFF_ROLE.get(u["role_code"], "SALES_STAFF"), "branchId": br,
              "initials": u["initials"] or "".join(w[0] for w in u["full_name"].split()[:2]).upper()}
             for u in db.all("""SELECT u.id, u.full_name, u.role_code, u.initials FROM app_user u WHERE u.org_id = ? AND u.is_active
                                AND (u.home_branch_id = ? OR u.id = ? OR EXISTS (SELECT 1 FROM user_branch_role r WHERE r.user_id = u.id AND r.branch_id = ?))
                                ORDER BY u.full_name""", (org, br, p.actor.user_id, br))]
    known = {x["userId"] for x in staff}
    for u in db.all("SELECT id, full_name, role_code, initials FROM app_user WHERE org_id = ?", (org,)):   # people named in older records
        if u["id"] not in known:
            staff.append({"userId": u["id"], "name": u["full_name"], "role": STAFF_ROLE.get(u["role_code"], "SALES_STAFF"), "branchId": br,
                          "initials": u["initials"] or "".join(w[0] for w in u["full_name"].split()[:2]).upper(), "inactive": True})
    menu = [{"id": m["menu_item_id"], "nameKey": m["name_key"], "category": m["category_code"], "price": float(m["price"])}
            for m in db.all("SELECT * FROM v_branch_menu WHERE branch_id = ?", (br,))]
    inventory = [{"id": r["item_id"], "nameKey": r["name_key"], "name": r["custom_name"], "category": r["cost_category_code"],
                  "main": r["main_category_code"], "unit": r["unit_code"], "unitCost": float(r["unit_cost"] or 0),
                  "currentQuantity": float(r["on_hand"]), "reorderPoint": float(r["reorder_point"])}
                 for r in db.all("""SELECT v.*, i.custom_name FROM v_branch_stock_status v JOIN inventory_item i ON i.id = v.item_id
                                    WHERE v.branch_id = ?""", (br,))]
    # sale lines are the bulk of the payload: sent as columns + rows (the app rebuilds the objects)
    sale_cols = ["id", "ticketNo", "menuItemId", "quantity", "unitPrice", "total", "paymentMethod", "shift", "loggedBy", "timestamp"]
    sale_rows = [[r["id"], r["ticket_no"], r["menu_item_id"], float(r["quantity"]), float(r["unit_price"]), float(r["total"]),
                  r["payment_method"] if r["payment_method"] in _PAY else "CASH", r["shift"] or "MORNING", r["logged_by"], iso(r["timestamp"])]
                 for r in db.all("SELECT * FROM v_sale_line WHERE branch_id = ? AND business_date >= ?", (br, since))]
    purchases = [{"id": r["id"], "itemId": r["item_id"], "category": r["cost_category_code"], "quantity": float(r["quantity"]), "unit": r["unit_code"],
                  "unitCost": float(r["unit_cost"]), "totalCost": float(r["total_cost"]), "vendor": r["vendor_name"] or "",
                  "paymentMethod": r["payment_method_code"] if r["payment_method_code"] in _PAY else "CASH", "loggedBy": r["logged_by"],
                  "timestamp": iso(r["purchased_at"]), "status": _REVIEW.get(r["review_status"], "PENDING"),
                  **({"reviewedBy": r["reviewed_by"], "reviewedAt": iso(r["reviewed_at"])} if r["reviewed_by"] else {}),
                  **({"flagReason": r["flag_reason"]} if r["flag_reason"] else {})}
                 for r in db.all("SELECT * FROM purchase WHERE branch_id = ? AND (business_date >= ? OR review_status = 'PENDING') AND deleted_at IS NULL",
                                 (br, since))]
    branches = {b["id"]: b for b in db.all("SELECT id, code FROM branch WHERE org_id = ?", (org,))}
    dispatches = []
    for r in db.all("""SELECT d.*, i.name_key, l.code AS dest FROM dispatch_request d JOIN inventory_item i ON i.id = d.item_id
                       LEFT JOIN stock_location l ON l.id = d.to_location_id
                       WHERE d.branch_id = ? AND (d.requested_at >= ? OR d.status = 'PENDING') AND d.status <> 'CANCELLED'""", (br, since)):
        dest = r["dest"] or ("BRANCH_PIASSA" if r["to_branch_id"] else "KITCHEN_LINE")
        dispatches.append({"id": r["id"], "itemId": r["item_id"], "itemName": r["name_key"], "quantity": float(r["quantity"]), "unit": r["unit_code"],
                           "requestedBy": r["requested_by"], "status": "APPROVED" if r["status"] == "RECEIVED" else r["status"],
                           "destination": dest, "timestamp": iso(r["requested_at"]),
                           **({"rejectionReason": r["rejection_reason"]} if r["rejection_reason"] else {}),
                           **({"approvedBy": r["decided_by"], "decidedAt": iso(r["decided_at"])} if r["decided_by"] else {})})
    waste = [{"id": r["id"], "itemId": r["item_id"], "itemName": r["name_key"], "quantityLost": float(r["quantity_lost"]), "unit": r["unit_code"],
              "lossValue": float(r["loss_value"]), "reason": r["reason_code"], **({"customNotes": r["notes"]} if r["notes"] else {}),
              "reportedBy": r["reported_by"], "loggedBy": r["logged_by"], "timestamp": iso(r["occurred_at"]),
              **({"pending": True} if r["approval_status"] == "PENDING" else {})}
             for r in db.all("""SELECT w.*, i.name_key FROM waste_report w JOIN inventory_item i ON i.id = w.item_id
                                WHERE w.branch_id = ? AND (w.business_date >= ? OR w.approval_status = 'PENDING')
                                AND w.approval_status IN ('PENDING','APPROVED') AND w.deleted_at IS NULL""", (br, since))]
    expenses = [{"id": r["id"], "reason": r["reason"], "amount": float(r["amount"]),
                 "source": "PETTY_CASH" if r["kind"] == "PETTY_CASH" else (r["payment_method_code"] if r["payment_method_code"] in _PAY else "CASH"),
                 "note": r["note"] or "", "loggedBy": r["logged_by"], "timestamp": iso(r["spent_at"])}
                for r in db.all("""SELECT e.*, a.kind FROM expense e LEFT JOIN money_account a ON a.id = e.money_account_id
                                   WHERE e.branch_id = ? AND e.business_date >= ? AND e.deleted_at IS NULL""", (br, since))]
    item_key = {i["id"]: i["nameKey"] for i in inventory}
    rows = {"purchase": {x["id"]: x for x in purchases}, "dispatch_request": {x["id"]: x for x in dispatches},
            "waste_report": {x["id"]: x for x in waste}}
    audit = []
    for a in db.all("""SELECT * FROM audit_log WHERE org_id = ? AND (branch_id = ? OR branch_id IS NULL) AND (module IN ('MGR','SALES') OR action = 'auth.sign_in')
                       AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT 600""", (org, br, since)):
        v = db.json(a["vars"]) or {}
        act = "UNDO" if a["action"].endswith(".undo") or a["action"].endswith(".delete") else _MGR_ACTION.get(a["action"])
        if not act:
            continue
        rec = rows.get(a["entity_type"] or "", {}).get(a["entity_id"] or "")
        e = {"id": str(a["id"]), "action": act, "userId": a["actor_user_id"] or "", "timestamp": iso(a["occurred_at"])}
        key = ((rec or {}).get("itemName") or item_key.get((rec or {}).get("itemId", "")) or v.get("itemKey")
               or (v.get("name") if str(v.get("name", "")).startswith("inv.") else None))
        if key:
            e["itemKey"] = key
        qty = rec.get("quantity", rec.get("quantityLost")) if rec else _f(v.get("quantity"))
        if qty is not None:
            e["quantity"] = qty
        unit = (rec or {}).get("unit") or v.get("unit")
        if unit:
            e["unit"] = unit
        dest = (rec or {}).get("destination") or v.get("destination")
        if dest:
            e["destination"] = dest
        if _f(v.get("amount")) is not None:
            e["amount"] = _f(v["amount"])
        if act == "SWITCH_USER":
            text = a["actor_name"]
        elif act == "UNDO":
            text = {"purchase": "purchase review", "dispatch_request": "dispatch decision", "waste_report": "waste log",
                    "expense": "expense"}.get(a["entity_type"] or "")
        elif a["action"] == "waste_report.approve":
            text = "approved"
        elif a["action"] == "waste_report.reject":
            text = "rejected" + (f": {v['reason']}" if v.get("reason") else "")
        else:
            text = v.get("reason") or v.get("text")
        if text:
            e["text"] = text
        audit.append(e)
    branch = db.one("SELECT id, name FROM branch WHERE id = ?", (br,))
    return {"role": MGR_ROLE.get(p.actor.role), "branch": {"id": branch["id"], "name": branch["name"]}, "staff": staff, "menu": menu, "inventory": inventory, "sales": {"cols": sale_cols, "rows": sale_rows},
            "purchases": purchases, "dispatches": dispatches, "waste": waste, "expenses": expenses, "audit": audit}


@router.get("/overview")
def overview(period: str = "today", shift: str | None = None, p: Principal = Depends(require("mgr.dashboard")), db: Db = Depends(get_db)):
    a, b = period_range(period)
    br = branch_of(p)
    sales = db.all("""SELECT payment_method_code AS method, sum(op.amount) AS amount FROM order_payment op
                      JOIN customer_order o ON o.id = op.order_id
                      WHERE o.branch_id = ? AND o.business_date BETWEEN ? AND ? AND o.status = 'PAID' AND op.status = 'CAPTURED'
                      AND (CAST(? AS text) IS NULL OR o.shift_code = ?) GROUP BY payment_method_code""", (br, a, b, shift, shift))
    pay = {r["method"]: float(r["amount"]) for r in sales}
    return {
        "payments": {"cash": pay.get("CASH", 0), "telebirr": pay.get("TELEBIRR", 0), "cbeBirr": pay.get("CBE_BIRR", 0), "total": sum(pay.values())},
        "cogs": db.scalar("SELECT coalesce(sum(total_cost),0) FROM purchase WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND review_status = 'APPROVED' AND deleted_at IS NULL", (br, a, b)),
        "waste": db.scalar("SELECT coalesce(sum(loss_value),0) FROM waste_report WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND approval_status = 'APPROVED'", (br, a, b)),
        "expenses": db.scalar("SELECT coalesce(sum(amount),0) FROM expense WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL", (br, a, b)),
        "queue": db.all("SELECT entity_type, count(*) AS n FROM v_manager_queue WHERE branch_id = ? GROUP BY entity_type", (br,)),
        "lowStock": db.all("SELECT item_id, name_key, on_hand, reorder_point, unit_code FROM v_branch_stock_status WHERE branch_id = ? AND is_low_stock", (br,)),
        "onShift": db.all("""SELECT a.employee_id, u.full_name, a.shift_code, a.clock_in FROM attendance_record a JOIN app_user u ON u.id = a.employee_id
                             WHERE a.branch_id = ? AND a.status = 'CLOCKED_IN'""", (br,)),
    }


@router.get("/queue")
def queue(p: Principal = Depends(require("purchase.review", "waste.approve", "dispatch.approve")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM v_manager_queue WHERE branch_id = ? ORDER BY requested_at", (branch_of(p),))


@router.post("/purchases/{pid}/review")
def review(pid: str, body: Review, p: Principal = Depends(require("purchase.review")), db: Db = Depends(get_db)):
    with db.tx():
        return s.review_purchase(db, p.actor, pid, body.decision, body.reason)


@router.post("/waste/{wid}/decision")
def waste_decision(wid: str, body: Decision, p: Principal = Depends(require("waste.approve")), db: Db = Depends(get_db)):
    with db.tx():
        return s.decide_waste(db, p.actor, wid, body.approve, body.reason)


@router.get("/dispatch")
def dispatch_list(status: str | None = None, p: Principal = Depends(require("dispatch.approve", "dispatch.request")), db: Db = Depends(get_db)):
    return db.all("""SELECT d.*, l.code AS destination FROM dispatch_request d LEFT JOIN stock_location l ON l.id = d.to_location_id
                     WHERE d.branch_id = ? AND (CAST(? AS text) IS NULL OR d.status = ?) ORDER BY d.requested_at DESC""",
                  (branch_of(p), status, status))


@router.post("/dispatch/{did}/decision")
def dispatch_decision(did: str, body: Decision, p: Principal = Depends(require("dispatch.approve")), db: Db = Depends(get_db)):
    with db.tx():
        return s.decide_dispatch(db, p.actor, did, body.approve, body.reason)


@router.post("/dispatch/{did}/receive")
def dispatch_receive(did: str, p: Principal = Depends(require("dispatch.approve")), db: Db = Depends(get_db)):
    with db.tx():
        return s.receive_transfer(db, p.actor, did)


@router.post("/expenses/{eid}/review")
def expense_review(eid: str, body: Review, p: Principal = Depends(require("expense.review")), db: Db = Depends(get_db)):
    with db.tx():
        st = {"APPROVE": "APPROVED", "FLAG": "FLAGGED", "REJECT": "REJECTED"}[body.decision]
        db.update("expense", {"id": eid}, {"review_status": st, "reviewed_by": p.actor.user_id, "reviewed_at": s.now_iso()})
        s.audit(db, p.actor, "MGR", f"expense.{body.decision.lower()}", "expense", eid, "Expense {status}", {"status": st, "reason": body.reason})
        return db.one("SELECT * FROM expense WHERE id = ?", (eid,))


@router.get("/sales")
def sales_lines(period: str = "today", p: Principal = Depends(require("report.view", "mgr.dashboard")), db: Db = Depends(get_db)):
    """The old SaleLine list (what customers bought), never mixed with COGS."""
    a, b = period_range(period)
    return db.all("SELECT * FROM v_sale_line WHERE branch_id = ? AND business_date BETWEEN ? AND ? ORDER BY timestamp DESC", (branch_of(p), a, b))


@router.get("/reconciliation/{day}")
def reconciliation(day: str, p: Principal = Depends(require("fin.reconcile")), db: Db = Depends(get_db)):
    return {"expected": db.all("SELECT * FROM v_daily_payments WHERE branch_id = ? AND business_date = ?", (branch_of(p), day)),
            "reconciliation": db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (branch_of(p), day))}


@router.get("/audit")
def audit_trail(module: str | None = None, limit: int = 200, p: Principal = Depends(require("audit.view")), db: Db = Depends(get_db)):
    return db.all("""SELECT * FROM audit_log WHERE org_id = ? AND branch_id = ? AND (CAST(? AS text) IS NULL OR module = ?)
                     ORDER BY occurred_at DESC LIMIT ?""", (p.actor.org_id, branch_of(p), module, module, min(limit, 1000)))
