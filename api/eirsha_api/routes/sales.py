"""Sales / Inventory Clerk (sales-main): purchases, waste, custom expenses, items, dashboard, own audit."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import services as s
from ..db import new_id, now_iso
from . import Db, Depends, Principal, branch_of, get_db, period_range, require

router = APIRouter(tags=["sales"])


class PurchaseIn(BaseModel):
    itemId: str
    quantity: float = Field(gt=0)
    unitCost: float = Field(ge=0)
    vendorId: str | None = None
    vendor: str | None = None                      # free text, as the Sales UI sends it today
    paymentMethod: Literal["CASH", "TELEBIRR", "CBE_BIRR"] | None = "CASH"
    settlement: Literal["PAID_NOW", "ON_CREDIT"] = "PAID_NOW"
    vatAmount: float = 0
    hasVatReceipt: bool = False
    receiptNo: str | None = None
    note: str = ""
    clientRef: str | None = None                   # offline queue idempotency


class WasteIn(BaseModel):
    itemId: str
    quantityLost: float = Field(gt=0)
    reason: str
    customNotes: str | None = None
    reportedBy: str | None = None
    clientRef: str | None = None


class ExpenseIn(BaseModel):
    reason: str
    tag: str
    amount: float = Field(gt=0)
    paymentMethod: Literal["CASH", "TELEBIRR", "CBE_BIRR"]
    pettyCash: bool = False
    note: str = ""
    clientRef: str | None = None


class ItemIn(BaseModel):
    name: str
    main: str
    unit: str
    unitCost: float = 0
    aliases: list[str] = []


class DispatchIn(BaseModel):
    itemId: str
    quantity: float = Field(gt=0)
    destination: str | None = None                 # BAR, KITCHEN_LINE, …
    toBranchId: str | None = None
    note: str | None = None


@router.get("/inventory/items")
def items(q: str | None = None, p: Principal = Depends(require("purchase.log", "waste.log", "mgr.dashboard")), db: Db = Depends(get_db)):
    sql = """SELECT i.*, m.cost_category_code AS category, s.on_hand, s.reorder_point, s.last_unit_cost
             FROM inventory_item i JOIN inventory_main_category m ON m.code = i.main_category_code
             LEFT JOIN branch_stock s ON s.item_id = i.id AND s.branch_id = ?
             WHERE i.org_id = ? AND i.deleted_at IS NULL AND i.is_active"""
    args: list = [p.actor.branch_id, p.actor.org_id]
    if q:
        sql += " AND (lower(i.id) LIKE ? OR i.id IN (SELECT item_id FROM inventory_item_alias WHERE lower(alias) LIKE ?))"
        args += [f"%{q.lower()}%"] * 2
    return db.all(sql + " ORDER BY i.main_category_code, i.id", args)


@router.post("/inventory/items", status_code=201)
def add_item(body: ItemIn, p: Principal = Depends(require("purchase.log")), db: Db = Depends(get_db)):
    with db.tx():
        iid = new_id("inv")
        db.insert("inventory_item", {"id": iid, "org_id": p.actor.org_id, "name_key": f"inv.{iid}", "custom_name": body.name,
                                     "main_category_code": body.main, "unit_code": body.unit, "standard_unit_cost": body.unitCost,
                                     "is_custom": True, "created_by": p.actor.user_id})
        db.insert("i18n_text", {"id": new_id("t"), "org_id": p.actor.org_id, "key": f"inv.{iid}", "lang": "en", "text": body.name})
        for a in body.aliases:
            db.insert("inventory_item_alias", {"item_id": iid, "alias": a})
        s.audit(db, p.actor, "SALES", "inventory_item.create", "inventory_item", iid, "New item {name}", {"name": body.name})
        return db.one("SELECT * FROM inventory_item WHERE id = ?", (iid,))


@router.post("/purchases", status_code=201)
def create_purchase(body: PurchaseIn, p: Principal = Depends(require("purchase.log")), db: Db = Depends(get_db)):
    with db.tx():
        return s.log_purchase(db, p.actor, branch_of(p), body.itemId, body.quantity, body.unitCost, vendor_id=body.vendorId,
                              vendor_name=body.vendor, payment_method=body.paymentMethod, settlement=body.settlement,
                              vat_amount=body.vatAmount, has_vat_receipt=body.hasVatReceipt, receipt_no=body.receiptNo,
                              note=body.note, client_ref=body.clientRef)


@router.get("/purchases")
def list_purchases(period: str = "30d", status: str | None = None, include_deleted: bool = False,
                   p: Principal = Depends(require("purchase.log", "purchase.review")), db: Db = Depends(get_db)):
    a, b = period_range(period)
    return db.all("""SELECT p.*, u.full_name AS logged_by_name FROM purchase p JOIN app_user u ON u.id = p.logged_by
                     WHERE p.branch_id = ? AND p.business_date BETWEEN ? AND ? AND (CAST(? AS text) IS NULL OR p.review_status = ?)
                     AND (? OR p.deleted_at IS NULL) ORDER BY p.purchased_at DESC""",
                  (branch_of(p), a, b, status, status, include_deleted))


@router.delete("/purchases/{pid}")
def delete_purchase(pid: str, p: Principal = Depends(require("record.delete")), db: Db = Depends(get_db)):
    with db.tx():
        row = db.one("SELECT review_status FROM purchase WHERE id = ? AND org_id = ?", (pid, p.actor.org_id))
        if not row:
            raise s.NotFound("purchase not found")
        if row["review_status"] == "APPROVED":
            raise s.Conflict("approved purchases are corrected in Finance, not deleted")
        db.update("purchase", {"id": pid}, {"deleted_at": now_iso(), "deleted_by": p.actor.user_id})
        s.audit(db, p.actor, "SALES", "purchase.delete", "purchase", pid, "Deleted purchase")
    return {"ok": True}


@router.post("/purchases/{pid}/restore")
def restore_purchase(pid: str, p: Principal = Depends(require("record.delete")), db: Db = Depends(get_db)):
    with db.tx():
        db.update("purchase", {"id": pid}, {"deleted_at": None, "deleted_by": None})
        s.audit(db, p.actor, "SALES", "purchase.restore", "purchase", pid, "Restored purchase")
    return {"ok": True}


@router.post("/waste", status_code=201)
def create_waste(body: WasteIn, p: Principal = Depends(require("waste.log")), db: Db = Depends(get_db)):
    with db.tx():
        return s.log_waste(db, p.actor, branch_of(p), body.itemId, body.quantityLost, body.reason, body.customNotes,
                           body.reportedBy, body.clientRef)


@router.get("/waste")
def list_waste(period: str = "30d", p: Principal = Depends(require("waste.log", "waste.approve")), db: Db = Depends(get_db)):
    a, b = period_range(period)
    return db.all("SELECT * FROM waste_report WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY occurred_at DESC",
                  (branch_of(p), a, b))


@router.post("/expenses", status_code=201)
def create_expense(body: ExpenseIn, p: Principal = Depends(require("expense.log")), db: Db = Depends(get_db)):
    with db.tx():
        return s.log_expense(db, p.actor, branch_of(p), body.reason, body.tag, body.amount, body.paymentMethod,
                             petty_cash=body.pettyCash, note=body.note, client_ref=body.clientRef,
                             module="MGR" if p.actor.role == "BRANCH_MANAGER" else "SALES")


@router.get("/expenses")
def list_expenses(period: str = "30d", p: Principal = Depends(require("expense.log", "expense.review")), db: Db = Depends(get_db)):
    a, b = period_range(period)
    return db.all("SELECT * FROM expense WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY spent_at DESC",
                  (branch_of(p), a, b))


@router.post("/dispatch", status_code=201)
def create_dispatch(body: DispatchIn, p: Principal = Depends(require("dispatch.request")), db: Db = Depends(get_db)):
    with db.tx():
        return s.request_dispatch(db, p.actor, branch_of(p), body.itemId, body.quantity, to_location=body.destination,
                                  to_branch_id=body.toBranchId, note=body.note)


@router.get("/sales/dashboard")
def dashboard(period: str = "today", p: Principal = Depends(require("sales.dashboard")), db: Db = Depends(get_db)):
    """sales-main PeriodTotals."""
    a, b = period_range(period)
    br = branch_of(p)
    one = lambda sql: db.scalar(sql, (br, a, b)) or 0
    purchases = one("SELECT sum(total_cost) FROM purchase WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL")
    expenses = one("SELECT sum(amount) FROM expense WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL")
    return {"purchases": purchases,
            "entries": one("SELECT count(*) FROM purchase WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND deleted_at IS NULL"),
            "waste": one("SELECT sum(loss_value) FROM waste_report WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND approval_status = 'APPROVED' AND deleted_at IS NULL"),
            "wastePending": one("SELECT sum(loss_value) FROM waste_report WHERE branch_id = ? AND business_date BETWEEN ? AND ? AND approval_status = 'PENDING' AND deleted_at IS NULL"),
            "expenses": expenses, "spent": float(purchases) + float(expenses)}
