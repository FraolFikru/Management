"""Finance & Accounting (finance-main): Z-reports, payables, P&L, tax, cash & reconciliation, payroll journal."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import services as s
from ..db import new_id, now_iso
from . import Db, Depends, Principal, get_db, require

router = APIRouter(prefix="/finance", tags=["finance"])


class VendorIn(BaseModel):
    name: str
    tin: str | None = None
    vatRegistered: bool = False
    supplyKind: Literal["GOODS", "SERVICES"] = "GOODS"
    category: str | None = None
    termsDays: int = 0
    phone: str | None = None


class BillIn(BaseModel):
    vendorId: str
    billNo: str
    category: str
    issueDate: str
    dueDate: str
    description: str = ""
    subtotal: float = Field(ge=0)
    vat: float = 0
    hasReceipt: bool = False
    branchId: str | None = None


class BillPaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: Literal["CASH", "TELEBIRR", "CBE_BIRR"]
    date: str | None = None
    reference: str | None = None
    accountId: str | None = None


class ReconIn(BaseModel):
    cashCounted: float | None = None
    bankDeposit: float = 0
    bankConfirmed: bool = False
    telebirrReceived: float | None = None
    cbeBirrReceived: float | None = None
    note: str = ""


@router.get("/daily-sales")
def daily_sales(frm: str, to: str, branch: str | None = None, p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    """finance-main DailySales[]: {date, gross, vat, byMethod, food, beverage}."""
    rows = db.all("""SELECT business_date, sum(gross) AS gross, sum(vat) AS vat, sum(food_net) AS food, sum(beverage_net) AS beverage
                     FROM daily_sales_summary WHERE org_id = ? AND business_date BETWEEN ? AND ? AND (CAST(? AS text) IS NULL OR branch_id = ?)
                     GROUP BY business_date ORDER BY business_date""", (p.actor.org_id, frm, to, branch, branch))
    pays = db.all("""SELECT dp.business_date, dp.payment_method_code, sum(dp.amount) AS amount FROM daily_sales_payment dp
                     JOIN daily_sales_summary d ON d.branch_id = dp.branch_id AND d.business_date = dp.business_date
                     WHERE d.org_id = ? AND dp.business_date BETWEEN ? AND ? AND (CAST(? AS text) IS NULL OR dp.branch_id = ?)
                     GROUP BY dp.business_date, dp.payment_method_code""", (p.actor.org_id, frm, to, branch, branch))
    by: dict[str, dict] = {}
    for r in pays:
        by.setdefault(str(r["business_date"]), {})[r["payment_method_code"]] = r["amount"]
    return [{"date": str(r["business_date"]), "gross": r["gross"], "vat": r["vat"], "food": r["food"], "beverage": r["beverage"],
             "byMethod": {m: by.get(str(r["business_date"]), {}).get(m, 0) for m in ("CASH", "TELEBIRR", "CBE_BIRR")}} for r in rows]


@router.get("/vendors")
def vendors(p: Principal = Depends(require("fin.view", "purchase.log")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM vendor WHERE org_id = ? AND deleted_at IS NULL ORDER BY name", (p.actor.org_id,))


@router.post("/vendors", status_code=201)
def add_vendor(body: VendorIn, p: Principal = Depends(require("fin.bill_manage")), db: Db = Depends(get_db)):
    with db.tx():
        vid = new_id("ven")
        db.insert("vendor", {"id": vid, "org_id": p.actor.org_id, "name": body.name, "tin_number": body.tin, "vat_registered": body.vatRegistered,
                             "supply_kind": body.supplyKind, "default_cost_category": body.category, "payment_terms_days": body.termsDays,
                             "phone": body.phone})
        s.audit(db, p.actor, "FIN", "vendor.create", "vendor", vid, "Vendor {name} added", {"name": body.name})
        return db.one("SELECT * FROM vendor WHERE id = ?", (vid,))


@router.get("/bills")
def bills(status: str | None = None, p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    """Includes display_status OPEN / PARTIAL / DUE_SOON / OVERDUE / PAID and links back to the purchase(s)."""
    rows = db.all("SELECT * FROM v_bill_status WHERE org_id = ? AND (CAST(? AS text) IS NULL OR display_status = ?) ORDER BY due_date",
                  (p.actor.org_id, status, status))
    for r in rows:
        r["payments"] = db.all("SELECT * FROM bill_payment WHERE bill_id = ? ORDER BY paid_on", (r["id"],))
        r["purchaseIds"] = [x["purchase_id"] for x in db.all("SELECT purchase_id FROM bill_line WHERE bill_id = ? AND purchase_id IS NOT NULL", (r["id"],))]
    return rows


@router.post("/bills", status_code=201)
def add_bill(body: BillIn, p: Principal = Depends(require("fin.bill_manage")), db: Db = Depends(get_db)):
    with db.tx():
        bid = new_id("bill")
        db.insert("bill", {"id": bid, "org_id": p.actor.org_id, "branch_id": body.branchId, "vendor_id": body.vendorId, "bill_no": body.billNo,
                           "cost_category_code": body.category, "issue_date": body.issueDate, "due_date": body.dueDate,
                           "description": body.description, "subtotal": body.subtotal, "vat": body.vat, "has_vat_receipt": body.hasReceipt,
                           "entered_by": p.actor.user_id})
        s.audit(db, p.actor, "FIN", "bill.create", "bill", bid, "Bill {billNo} entered", {"billNo": body.billNo, "amount": body.subtotal + body.vat})
        return db.one("SELECT * FROM v_bill_status WHERE id = ?", (bid,))


@router.post("/bills/{bid}/payments")
def pay_bill(bid: str, body: BillPaymentIn, p: Principal = Depends(require("fin.bill_pay")), db: Db = Depends(get_db)):
    with db.tx():
        return s.pay_bill(db, p.actor, bid, body.amount, body.method, body.date, body.reference, body.accountId)


@router.get("/pnl")
def pnl(frm: str, to: str, branch: str | None = None, p: Principal = Depends(require("fin.view", "owner.dashboard")), db: Db = Depends(get_db)):
    return db.all("""SELECT month, section, category, sum(amount) AS amount FROM v_pnl_monthly
                     WHERE org_id = ? AND month BETWEEN ? AND ? AND (CAST(? AS text) IS NULL OR branch_id = ?)
                     GROUP BY month, section, category ORDER BY month, section, category""", (p.actor.org_id, frm, to, branch, branch))


@router.get("/tax")
def tax(p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    return {"vat": db.all("SELECT * FROM v_vat_monthly WHERE org_id = ? ORDER BY month", (p.actor.org_id,)),
            "withholding": db.all("SELECT * FROM v_wht_monthly WHERE org_id = ? ORDER BY month", (p.actor.org_id,)),
            "filings": db.all("SELECT * FROM tax_filing WHERE org_id = ? ORDER BY period_month DESC, kind", (p.actor.org_id,))}


@router.post("/tax-filings/{fid}/file")
def file_tax(fid: str, reference: str, p: Principal = Depends(require("fin.tax_file")), db: Db = Depends(get_db)):
    with db.tx():
        db.update("tax_filing", {"id": fid, "org_id": p.actor.org_id}, {"status": "FILED", "filed_by": p.actor.user_id, "filed_at": now_iso(), "reference": reference})
        s.audit(db, p.actor, "FIN", "tax_filing.file", "tax_filing", fid, "Tax return filed ({reference})", {"reference": reference})
        return db.one("SELECT * FROM tax_filing WHERE id = ?", (fid,))


@router.get("/cash")
def cash(p: Principal = Depends(require("fin.view", "owner.dashboard")), db: Db = Depends(get_db)):
    return {"accounts": db.all("SELECT * FROM v_account_balance WHERE org_id = ? ORDER BY kind", (p.actor.org_id,)),
            "movements": db.all("SELECT * FROM cash_movement WHERE org_id = ? ORDER BY occurred_on DESC, created_at DESC LIMIT 300", (p.actor.org_id,))}


@router.put("/reconciliations/{branch}/{day}")
def reconcile(branch: str, day: str, body: ReconIn, p: Principal = Depends(require("fin.reconcile")), db: Db = Depends(get_db)):
    from decimal import Decimal
    tol = Decimal(50)        # finance-main RECON_TOLERANCE
    with db.tx():
        r = db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ? AND org_id = ?", (branch, day, p.actor.org_id))
        if not r:
            raise s.NotFound("close the day first (POST /pos/day-close)")
        diffs = [abs(s.D(body.cashCounted) - s.D(r["cash_expected"])) if body.cashCounted is not None else Decimal(0),
                 abs(s.D(body.telebirrReceived) - s.D(r["telebirr_expected"])) if body.telebirrReceived is not None else Decimal(0),
                 abs(s.D(body.cbeBirrReceived) - s.D(r["cbe_birr_expected"])) if body.cbeBirrReceived is not None else Decimal(0)]
        status = "VARIANCE" if max(diffs) > tol else "MATCHED"
        db.update("cash_reconciliation", {"branch_id": branch, "business_date": day},
                  {"cash_counted": body.cashCounted, "bank_deposit": body.bankDeposit, "bank_confirmed": body.bankConfirmed,
                   "telebirr_received": body.telebirrReceived, "cbe_birr_received": body.cbeBirrReceived, "note": body.note,
                   "status": status, "reconciled_by": p.actor.user_id, "reconciled_at": now_iso()})
        s.audit(db, p.actor, "FIN", "cash_reconciliation.save", "cash_reconciliation", f"{branch}:{day}", "Reconciliation {status}", {"status": status}, branch_id=branch)
        return db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (branch, day))


@router.get("/payroll-journal")
def payroll_journal(p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    """finance-main PayrollCost[]: {month, gross, employerPension, paidOn} — straight from HR's payroll runs."""
    return [{"month": str(r["period_month"])[:7], "gross": r["total_gross"], "employerPension": r["total_pension_employer"],
             "paidOn": r["paid_on"], "status": r["status"]}
            for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') ORDER BY period_month", (p.actor.org_id,))]
