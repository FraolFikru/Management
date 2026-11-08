"""Branch Manager (managgerr-main): overview, review queues, sales & payment reconciliation, audit."""
from __future__ import annotations

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
