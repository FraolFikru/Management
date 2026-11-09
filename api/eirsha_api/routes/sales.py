"""Sales / Inventory Clerk (sales-main): purchases, waste, custom expenses, items, dashboard, own audit."""
from __future__ import annotations

from typing import Literal

from datetime import date, timedelta

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .. import services as s
from ..db import new_id, now_iso
from . import Db, Depends, Principal, branch_of, get_db, period_range, require

router = APIRouter(tags=["sales"])


class PurchaseIn(BaseModel):
    id: str | None = None                          # the Sales app's own id, so its undo/delete hit the same row
    itemId: str
    unit: str | None = None                        # defaults to the item's unit
    timestamp: str | None = None                   # back-dated purchase
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
    id: str | None = None
    unitCost: float | None = None                  # the cost the clerk saw; default = current stock cost
    timestamp: str | None = None
    itemId: str
    quantityLost: float = Field(gt=0)
    reason: str
    customNotes: str | None = None
    reportedBy: str | None = None
    clientRef: str | None = None
    approve: bool = False                          # a manager logging waste themselves: decided at once (needs waste.approve)


class ExpenseIn(BaseModel):
    id: str | None = None
    timestamp: str | None = None
    reason: str
    tag: str
    amount: float = Field(gt=0)
    paymentMethod: Literal["CASH", "TELEBIRR", "CBE_BIRR"]
    pettyCash: bool = False
    note: str = ""
    clientRef: str | None = None


class ItemIn(BaseModel):
    id: str | None = None
    nameKey: str | None = None
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
        iid = body.id or new_id("inv")
        if db.scalar("SELECT 1 FROM inventory_item WHERE id = ?", (iid,)):
            return db.one("SELECT * FROM inventory_item WHERE id = ?", (iid,))
        key = body.nameKey or f"inv.{iid}"
        db.insert("inventory_item", {"id": iid, "org_id": p.actor.org_id, "name_key": key, "custom_name": body.name,
                                     "main_category_code": body.main, "unit_code": body.unit, "standard_unit_cost": body.unitCost,
                                     "is_custom": True, "created_by": p.actor.user_id})
        db.insert("i18n_text", {"id": new_id("t"), "org_id": p.actor.org_id, "key": key, "lang": "en", "text": body.name})
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
                              note=body.note, client_ref=body.clientRef, purchased_at=body.timestamp, id=body.id, unit=body.unit)


@router.get("/purchases")
def list_purchases(period: str = "30d", status: str | None = None, include_deleted: bool = False,
                   p: Principal = Depends(require("purchase.log", "purchase.review")), db: Db = Depends(get_db)):
    a, b = period_range(period)
    return db.all("""SELECT p.*, u.full_name AS logged_by_name FROM purchase p JOIN app_user u ON u.id = p.logged_by
                     WHERE p.branch_id = ? AND p.business_date BETWEEN ? AND ? AND (CAST(? AS text) IS NULL OR p.review_status = ?)
                     AND (? OR p.deleted_at IS NULL) ORDER BY p.purchased_at DESC""",
                  (branch_of(p), a, b, status, status, include_deleted))


def _can_manage(p: Principal) -> bool:
    return "record.delete" in p.permissions


@router.delete("/purchases/{rid}")
@router.delete("/waste/{rid}")
@router.delete("/expenses/{rid}")
def delete_entry(rid: str, request: Request, p: Principal = Depends(require("purchase.log", "waste.log", "expense.log", "record.delete")),
                 db: Db = Depends(get_db)):
    """Managers delete; the person who saved an entry may undo it within 10 minutes while it is undecided."""
    entity = {"purchases": "purchase", "waste": "waste_report", "expenses": "expense"}[request.url.path.strip("/").split("/")[0]]
    with db.tx():
        return s.delete_record(db, p.actor, entity, rid, _can_manage(p))


@router.post("/purchases/{rid}/restore")
@router.post("/waste/{rid}/restore")
@router.post("/expenses/{rid}/restore")
def restore_entry(rid: str, request: Request, p: Principal = Depends(require("purchase.log", "waste.log", "expense.log", "record.delete")),
                  db: Db = Depends(get_db)):
    entity = {"purchases": "purchase", "waste": "waste_report", "expenses": "expense"}[request.url.path.strip("/").split("/")[0]]
    with db.tx():
        return s.restore_record(db, p.actor, entity, rid, _can_manage(p))


@router.post("/waste", status_code=201)
def create_waste(body: WasteIn, p: Principal = Depends(require("waste.log")), db: Db = Depends(get_db)):
    with db.tx():
        w = s.log_waste(db, p.actor, branch_of(p), body.itemId, body.quantityLost, body.reason, body.customNotes,
                        body.reportedBy, body.clientRef, id=body.id, unit_cost=body.unitCost, occurred_at=body.timestamp)
        if body.approve and "waste.approve" in p.permissions and w["approval_status"] == "PENDING":
            w = s.decide_waste(db, p.actor, w["id"], True)
        return w


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
                             module="MGR" if p.actor.role == "BRANCH_MANAGER" else "SALES", id=body.id, spent_at=body.timestamp)


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


# ---------- one call that fills the Sales app (same shapes as sales-main types.ts) ----------

SALES_ROLE = {"ADMIN": "ADMIN", "OWNER": "ADMIN", "BRANCH_MANAGER": "MANAGER", "INVENTORY_CLERK": "INVENTORY_CLERK"}
_ACTION = {"create": "CREATE", "delete": "DELETE", "restore": "RESTORE", "approve": "APPROVE", "reject": "REJECT",
           "sign_in": "SIGN_IN", "sign_out": "SIGN_OUT"}
_ENTITY = {"purchase": "PURCHASE", "waste_report": "WASTE", "expense": "EXPENSE", "inventory_item": "ITEM", "auth": "SESSION"}


@router.get("/sales/bootstrap")
def sales_bootstrap(days: int = 60, p: Principal = Depends(require("purchase.log", "waste.log", "expense.log", "waste.approve")),
                    db: Db = Depends(get_db)):
    br, org = branch_of(p), p.actor.org_id
    since = (date.today() - timedelta(days=days)).isoformat()
    names = {u["id"]: u["full_name"] for u in db.all("SELECT id, full_name FROM app_user WHERE org_id = ?", (org,))}
    iso = s._iso
    purchases = [{"id": r["id"], "category": r["cost_category_code"], "itemName": r["name_key"], "quantity": float(r["quantity"]), "unit": r["unit_code"],
                  "unitCost": float(r["unit_cost"]), "totalCost": float(r["total_cost"]), "loggedBy": names.get(r["logged_by"], r["logged_by"]),
                  "timestamp": iso(r["purchased_at"]), "itemId": r["item_id"], "vendor": r["vendor_name"], "paymentMethod": r["payment_method_code"] or "CASH",
                  "userId": r["logged_by"], "note": r["note"] or "", "reviewStatus": r["review_status"]}
                 for r in db.all("""SELECT p.*, i.name_key FROM purchase p JOIN inventory_item i ON i.id = p.item_id
                                    WHERE p.branch_id = ? AND p.business_date >= ? AND p.deleted_at IS NULL ORDER BY p.purchased_at""", (br, since))]
    waste = [{"id": r["id"], "itemId": r["item_id"], "itemName": r["name_key"], "quantityLost": float(r["quantity_lost"]), "unit": r["unit_code"],
              "lossValue": float(r["loss_value"]), "reason": r["reason_code"], **({"customNotes": r["notes"]} if r["notes"] else {}),
              "reportedBy": names.get(r["reported_by"], r["reported_by"]), "timestamp": iso(r["occurred_at"]), "unitCost": float(r["unit_cost"]),
              "userId": r["logged_by"], "approval": r["approval_status"], "approvedBy": names.get(r["decided_by"]) if r["decided_by"] else None,
              "approvedAt": iso(r["decided_at"]) if r["decided_at"] else None}
             for r in db.all("""SELECT w.*, i.name_key FROM waste_report w JOIN inventory_item i ON i.id = w.item_id
                                WHERE w.branch_id = ? AND w.business_date >= ? AND w.deleted_at IS NULL ORDER BY w.occurred_at""", (br, since))]
    expenses = [{"id": r["id"], "reason": r["reason"], "tag": r["tag_code"], "amount": float(r["amount"]), "paymentMethod": r["payment_method_code"],
                 "note": r["note"] or "", "loggedBy": names.get(r["logged_by"], r["logged_by"]), "userId": r["logged_by"], "timestamp": iso(r["spent_at"])}
                for r in db.all("SELECT * FROM expense WHERE branch_id = ? AND business_date >= ? AND deleted_at IS NULL ORDER BY spent_at", (br, since))]
    custom = []
    for r in db.all("""SELECT i.*, m.cost_category_code FROM inventory_item i JOIN inventory_main_category m ON m.code = i.main_category_code
                       WHERE i.org_id = ? AND i.is_custom AND i.deleted_at IS NULL""", (org,)):
        custom.append({"id": r["id"], "nameKey": r["name_key"], "name": r["custom_name"] or r["id"], "category": r["cost_category_code"],
                       "main": r["main_category_code"], "groupKey": r["group_key"] or f"main.{r['main_category_code']}", "unit": r["unit_code"],
                       "unitCost": float(r["standard_unit_cost"]), "aliases": [], "custom": True})
    audit = []
    for a in db.all("""SELECT * FROM audit_log WHERE org_id = ? AND (branch_id = ? OR branch_id IS NULL)
                       AND (module = 'SALES' OR action LIKE ?) ORDER BY occurred_at DESC LIMIT 400""", (org, br, "auth.%")):
        head, _, verb = a["action"].partition(".")
        action, entity = _ACTION.get(verb), _ENTITY.get(head)
        if not action or not entity:
            continue
        v = db.json(a["vars"]) or {}
        detail = {k: v[k] for k in ("name", "quantity", "unit") if k in v}
        if "amount" in v:
            try:
                detail["amount"] = float(v["amount"])
            except (TypeError, ValueError):
                pass
        if entity == "EXPENSE" and "reason" in v:
            detail["name"] = v["reason"]
        for k in ("quantity",):
            if k in detail:
                try:
                    detail[k] = float(detail[k])
                except (TypeError, ValueError):
                    detail.pop(k)
        audit.append({"id": str(a["id"]), "action": action, "entity": entity, "entityId": a["entity_id"] or "", "summary": a["summary_template"],
                      "detail": detail, "userId": a["actor_user_id"] or "", "userName": a["actor_name"] or names.get(a["actor_user_id"], ""),
                      "role": SALES_ROLE.get(a["actor_role"] or "", "INVENTORY_CLERK"), "timestamp": iso(a["occurred_at"])})
    return {"role": SALES_ROLE.get(p.actor.role), "purchases": purchases, "waste": waste, "expenses": expenses,
            "customInventory": custom, "audit": audit}
