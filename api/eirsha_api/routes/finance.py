"""Finance & Accounting (finance-main): Z-reports, payables, P&L, tax, cash & reconciliation, payroll journal."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
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
    id: str | None = None                          # the app's own id, so its undo hits the same bill
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
    id: str | None = None
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
        if body.id and db.scalar("SELECT 1 FROM bill WHERE id = ?", (body.id,)):
            return db.one("SELECT * FROM v_bill_status WHERE id = ?", (body.id,))
        bid = body.id or new_id("bill")
        db.insert("bill", {"id": bid, "org_id": p.actor.org_id, "branch_id": body.branchId, "vendor_id": body.vendorId, "bill_no": body.billNo,
                           "cost_category_code": body.category, "issue_date": body.issueDate, "due_date": body.dueDate,
                           "description": body.description, "subtotal": body.subtotal, "vat": body.vat, "has_vat_receipt": body.hasReceipt,
                           "entered_by": p.actor.user_id})
        s.audit(db, p.actor, "FIN", "bill.create", "bill", bid, "Bill {billNo} entered", {"billNo": body.billNo, "amount": body.subtotal + body.vat})
        return db.one("SELECT * FROM v_bill_status WHERE id = ?", (bid,))


@router.post("/bills/{bid}/payments")
def pay_bill(bid: str, body: BillPaymentIn, p: Principal = Depends(require("fin.bill_pay")), db: Db = Depends(get_db)):
    with db.tx():
        return s.pay_bill(db, p.actor, bid, body.amount, body.method, body.date, body.reference, body.accountId, id=body.id)


@router.delete("/bills/{bid}")
def void_bill(bid: str, p: Principal = Depends(require("fin.bill_manage")), db: Db = Depends(get_db)):
    """Undo of a bill just entered: it is voided (kept for the record). Not possible once something was paid on it."""
    with db.tx():
        b = s._get(db, "bill", bid, p.actor.org_id)
        if db.scalar("SELECT 1 FROM bill_payment WHERE bill_id = ?", (bid,)):
            raise s.Conflict("this bill has payments; undo those first")
        if b["source"] == "PURCHASE":
            raise s.Conflict("this bill comes from an approved purchase; the manager can undo the approval")
        db.update("bill", {"id": bid}, {"status": "VOID", "voided_by": p.actor.user_id, "voided_at": now_iso()})
        s.audit(db, p.actor, "FIN", "bill.void", "bill", bid, "Bill {billNo} voided", {"billNo": b["bill_no"]})
        return {"id": bid, "status": "VOID"}


@router.delete("/bill-payments/{pid}")
def undo_payment(pid: str, p: Principal = Depends(require("fin.bill_pay")), db: Db = Depends(get_db)):
    with db.tx():
        return s.undo_bill_payment(db, p.actor, pid)


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


class FilingIn(BaseModel):
    filed: bool
    reference: str | None = None
    amount: float | None = None                    # VAT payable / WHT withheld for the month, paid from the bank


@router.put("/tax-filings/{month}/{kind}")
def set_filing(month: str, kind: Literal["VAT", "WHT"], body: FilingIn, p: Principal = Depends(require("fin.tax_file")), db: Db = Depends(get_db)):
    """Mark a monthly return filed (the tax is paid from the CBE bank account) or reopen it (the payment is reversed)."""
    first = f"{month[:7]}-01"
    with db.tx():
        f = db.one("SELECT * FROM tax_filing WHERE org_id = ? AND kind = ? AND period_month = ?", (p.actor.org_id, kind, first))
        if not f:
            fid = new_id("tax")
            db.insert("tax_filing", {"id": fid, "org_id": p.actor.org_id, "period_month": first, "kind": kind, "status": "OPEN"})
            f = db.one("SELECT * FROM tax_filing WHERE id = ?", (fid,))
        bank = db.scalar("SELECT id FROM money_account WHERE org_id = ? AND kind = 'BANK' AND is_active ORDER BY branch_id IS NULL DESC LIMIT 1",
                         (p.actor.org_id,))
        paid = s.money(f["amount_due"]) if f["amount_due"] is not None and f["status"] != "OPEN" else Decimal(0)
        if body.filed:
            if f["status"] != "OPEN":
                return f
            amt = s.money(body.amount or 0)
            db.update("tax_filing", {"id": f["id"]}, {"status": "FILED", "filed_by": p.actor.user_id, "filed_at": now_iso(),
                                                      "reference": body.reference, "amount_due": amt})
            if amt > 0 and bank:
                s.cash_move(db, p.actor, bank, -amt, "TAX", f"{kind} {month[:7]}", "tax_filing", f["id"])
            s.audit(db, p.actor, "FIN", "tax_filing.file", "tax_filing", f["id"], "{kind} return {month} filed ({reference})",
                    {"kind": kind, "month": month[:7], "reference": body.reference, "amount": str(amt)})
        else:
            if f["status"] == "OPEN":
                return f
            if paid > 0 and bank:
                s.cash_move(db, p.actor, bank, paid, "TAX", f"Reversed {kind} {month[:7]}", "tax_filing", f["id"])
            db.update("tax_filing", {"id": f["id"]}, {"status": "OPEN", "filed_by": None, "filed_at": None, "reference": None, "amount_due": None})
            s.audit(db, p.actor, "FIN", "tax_filing.reopen", "tax_filing", f["id"], "{kind} return {month} reopened", {"kind": kind, "month": month[:7]})
        return db.one("SELECT * FROM tax_filing WHERE id = ?", (f["id"],))


@router.get("/cash")
def cash(p: Principal = Depends(require("fin.view", "owner.dashboard")), db: Db = Depends(get_db)):
    return {"accounts": db.all("SELECT * FROM v_account_balance WHERE org_id = ? ORDER BY kind", (p.actor.org_id,)),
            "movements": db.all("SELECT * FROM cash_movement WHERE org_id = ? ORDER BY occurred_on DESC, created_at DESC LIMIT 300", (p.actor.org_id,))}


@router.put("/reconciliations/{branch}/{day}")
def reconcile(branch: str, day: str, body: ReconIn, p: Principal = Depends(require("fin.reconcile")), db: Db = Depends(get_db)):
    from decimal import Decimal
    tol, float_ = Decimal(50), Decimal(2000)        # finance-main RECON_TOLERANCE, DAILY_FLOAT
    with db.tx():
        r = db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ? AND org_id = ?", (branch, day, p.actor.org_id))
        if not r:                     # the day was never closed at the till: expected amounts straight from the payments
            exp = {x["payment_method_code"]: s.money(x["amount"])
                   for x in db.all("SELECT * FROM v_daily_payments WHERE branch_id = ? AND business_date = ?", (branch, day))}
            db.insert("cash_reconciliation", {"org_id": p.actor.org_id, "branch_id": branch, "business_date": day,
                                              "cash_expected": exp.get("CASH", 0), "telebirr_expected": exp.get("TELEBIRR", 0),
                                              "cbe_birr_expected": exp.get("CBE_BIRR", 0)})
            r = db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (branch, day))
        off = lambda a, b: abs(s.D(a or 0) - s.D(b or 0)) > tol
        counted = body.cashCounted if body.cashCounted is not None else r["cash_expected"]
        variance = (off(counted, r["cash_expected"]) or off(body.bankDeposit, s.D(counted) - float_) or not body.bankConfirmed
                    or (body.telebirrReceived is not None and off(body.telebirrReceived, r["telebirr_expected"]))
                    or (body.cbeBirrReceived is not None and off(body.cbeBirrReceived, r["cbe_birr_expected"])))
        status = "VARIANCE" if variance else "MATCHED"
        db.update("cash_reconciliation", {"branch_id": branch, "business_date": day},
                  {"cash_counted": body.cashCounted, "bank_deposit": body.bankDeposit, "bank_confirmed": body.bankConfirmed,
                   "telebirr_received": body.telebirrReceived, "cbe_birr_received": body.cbeBirrReceived, "note": body.note,
                   "status": status, "reconciled_by": p.actor.user_id, "reconciled_at": now_iso()})
        # a confirmed bank deposit moves that cash from the safe to the CBE account (re-saving adjusts it)
        rid = f"{branch}:{day}"
        acc = lambda kind: db.scalar("SELECT id FROM money_account WHERE org_id = ? AND kind = ? AND is_active ORDER BY branch_id IS NULL DESC LIMIT 1",
                                     (p.actor.org_id, kind))
        bank, safe = acc("BANK"), acc("SAFE")
        if bank and safe:
            done = s.money(db.scalar("SELECT coalesce(sum(amount), 0) FROM cash_movement WHERE source_type = 'cash_reconciliation' AND source_id = ? AND money_account_id = ?",
                                     (rid, bank)))
            delta = (s.money(body.bankDeposit) if body.bankConfirmed else Decimal(0)) - done
            if delta:
                nxt = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
                s.cash_move(db, p.actor, safe, -delta, "DEPOSIT", "Deposit to CBE", "cash_reconciliation", rid, on=nxt, branch_id=branch)
                s.cash_move(db, p.actor, bank, delta, "DEPOSIT", "Cash deposit", "cash_reconciliation", rid, on=nxt, branch_id=branch)
        s.audit(db, p.actor, "FIN", "cash_reconciliation.save", "cash_reconciliation", f"{branch}:{day}", "Reconciliation {status}", {"status": status}, branch_id=branch)
        return db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (branch, day))


@router.get("/payroll-journal")
def payroll_journal(p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    """finance-main PayrollCost[]: {month, gross, employerPension, paidOn} — straight from HR's payroll runs."""
    return [{"month": str(r["period_month"])[:7], "gross": r["total_gross"], "employerPension": r["total_pension_employer"],
             "paidOn": r["paid_on"], "status": r["status"]}
            for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') ORDER BY period_month", (p.actor.org_id,))]


# ---------- one call that fills the Finance app (same shapes as finance-main types.ts) ----------

FIN_ROLES = {"ACCOUNTANT", "ADMIN", "OWNER"}
_ACCOUNT = {"SAFE": "CASH", "CASH_DRAWER": "CASH", "PETTY_CASH": "CASH", "BANK": "BANK", "TELEBIRR": "TELEBIRR", "CBE_BIRR": "CBE_BIRR"}
_MOVE = {"SALES": "SALES", "DEPOSIT": "DEPOSIT", "VENDOR": "VENDOR", "EXPENSE": "VENDOR", "PAYROLL": "PAYROLL", "TAX": "TAX",
         "FEE": "FEE", "TRANSFER": "TRANSFER", "ADJUSTMENT": "TRANSFER"}
_PAY = ("CASH", "TELEBIRR", "CBE_BIRR")
EXPENSE_VENDOR = "EXPENSES"


def _n(v) -> float:
    return float(v or 0)


def _last_day(month_first: str) -> str:
    d = date.fromisoformat(month_first[:7] + "-01")
    return ((d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).isoformat()


@router.get("/bootstrap")
def finance_bootstrap(p: Principal = Depends(require("fin.view")), db: Db = Depends(get_db)):
    org = p.actor.org_id
    today = date.today()
    iso = s._iso
    users = [{"id": u["id"], "name": u["full_name"], "role": u["role_code"]}
             for u in db.all("SELECT id, full_name, role_code FROM app_user WHERE org_id = ?", (org,))]
    vendors = [{"id": v["id"], "name": v["name"], "tin": v["tin_number"] or "", "vatRegistered": bool(v["vat_registered"]),
                "supplyKind": v["supply_kind"] or "GOODS", "category": v["default_cost_category"] or "OTHER_OPEX",
                "termsDays": int(v["payment_terms_days"] or 0), "phone": v["phone"] or ""}
               for v in db.all("SELECT * FROM vendor WHERE org_id = ? AND deleted_at IS NULL ORDER BY name", (org,))]
    vendors.append({"id": EXPENSE_VENDOR, "name": "Branch expenses (paid on the spot)", "tin": "", "vatRegistered": False,
                    "supplyKind": "SERVICES", "category": "OTHER_OPEX", "termsDays": 0, "phone": "", "internal": True})

    # --- daily sales: closed Z-reports, plus days the till never closed (straight from the orders)
    sales: dict[str, dict] = {}
    def day(d: str) -> dict:
        return sales.setdefault(d, {"date": d, "gross": 0.0, "vat": 0.0, "food": 0.0, "beverage": 0.0, "byMethod": {m: 0.0 for m in _PAY}})
    closed = set()
    for r in db.all("SELECT * FROM daily_sales_summary WHERE org_id = ?", (org,)):
        d = str(r["business_date"])[:10]
        closed.add((r["branch_id"], d))
        x = day(d); x["gross"] += _n(r["gross"]); x["vat"] += _n(r["vat"]); x["food"] += _n(r["food_net"]); x["beverage"] += _n(r["beverage_net"])
    for r in db.all("SELECT dp.* FROM daily_sales_payment dp JOIN branch b ON b.id = dp.branch_id WHERE b.org_id = ?", (org,)):
        d = str(r["business_date"])[:10]
        if r["payment_method_code"] in _PAY:
            day(d)["byMethod"][r["payment_method_code"]] += _n(r["amount"])
    for r in db.all("SELECT * FROM v_daily_sales_live WHERE org_id = ? AND gross IS NOT NULL", (org,)):
        d = str(r["business_date"])[:10]
        if (r["branch_id"], d) in closed:
            continue
        x = day(d); x["gross"] += _n(r["gross"]); x["vat"] += _n(r["vat"]); x["food"] += _n(r["food_net"]); x["beverage"] += _n(r["beverage_net"])
    for r in db.all("SELECT * FROM v_daily_payments WHERE org_id = ?", (org,)):
        d = str(r["business_date"])[:10]
        if (r["branch_id"], d) not in closed and r["payment_method_code"] in _PAY:
            day(d)["byMethod"][r["payment_method_code"]] += _n(r["amount"])
    sales_list = [{**x, **{k: round(x[k], 2) for k in ("gross", "vat", "food", "beverage")},
                   "byMethod": {m: round(v, 2) for m, v in x["byMethod"].items()}} for x in sorted(sales.values(), key=lambda x: x["date"])]

    # --- bills (+ payments), and on-the-spot expenses shown as paid bills so the P&L and VAT see them
    pays: dict[str, list] = {}
    for r in db.all("""SELECT bp.* FROM bill_payment bp JOIN bill b ON b.id = bp.bill_id WHERE b.org_id = ? ORDER BY bp.paid_on, bp.created_at""", (org,)):
        pays.setdefault(r["bill_id"], []).append({
            "id": r["id"], "date": str(r["paid_on"])[:10], "amount": _n(r["amount"]), "withheld": _n(r["withheld"]),
            "netPaid": round(_n(r["amount"]) - _n(r["withheld"]), 2), "method": r["payment_method_code"] if r["payment_method_code"] in _PAY else "CASH",
            "reference": r["reference"] or "", "paidBy": r["paid_by"] or "", "timestamp": iso(r["created_at"]),
            **({"noCash": True} if r["reference"] == "Paid at purchase" else {})})
    bills = [{"id": b["id"], "vendorId": b["vendor_id"], "billNo": b["bill_no"], "category": b["cost_category_code"],
              "issueDate": str(b["issue_date"])[:10], "dueDate": str(b["due_date"])[:10], "description": b["description"] or "",
              "subtotal": _n(b["subtotal"]), "vat": _n(b["vat"]), "total": round(_n(b["subtotal"]) + _n(b["vat"]), 2),
              "hasReceipt": bool(b["has_vat_receipt"]), "payments": pays.get(b["id"], []), "enteredBy": b["entered_by"] or "",
              **({"fromPurchase": True} if b["source"] == "PURCHASE" else {})}
             for b in db.all("SELECT * FROM bill WHERE org_id = ? AND status NOT IN ('VOID','DRAFT') ORDER BY issue_date", (org,))]
    for e in db.all("""SELECT e.*, t.cost_category_code AS cat FROM expense e JOIN expense_tag t ON t.code = e.tag_code
                       WHERE e.org_id = ? AND e.deleted_at IS NULL AND coalesce(e.review_status, 'PENDING') <> 'REJECTED'""", (org,)):
        d = str(e["business_date"])[:10]
        bills.append({"id": e["id"], "vendorId": EXPENSE_VENDOR, "billNo": e["reason"], "category": e["cat"], "issueDate": d, "dueDate": d,
                      "description": e["note"] or e["reason"], "subtotal": _n(e["amount"]), "vat": 0, "total": _n(e["amount"]), "hasReceipt": False,
                      "payments": [{"id": f"pay-{e['id']}", "date": d, "amount": _n(e["amount"]), "withheld": 0, "netPaid": _n(e["amount"]),
                                    "method": e["payment_method_code"] if e["payment_method_code"] in _PAY else "CASH", "reference": "Paid on the spot",
                                    "paidBy": e["logged_by"], "timestamp": iso(e["spent_at"]), "noCash": True}],
                      "enteredBy": e["logged_by"], "expense": True})

    payroll: dict[str, dict] = {}
    for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID')", (org,)):
        m = str(r["period_month"])[:7]
        x = payroll.setdefault(m, {"month": m, "gross": 0.0, "employerPension": 0.0, "paidOn": str(r["paid_on"] or _last_day(m))[:10]})
        x["gross"] += _n(r["total_gross"]); x["employerPension"] += _n(r["total_pension_employer"])
    filings = [{"month": str(f["period_month"])[:7], "kind": f["kind"], "status": "OPEN" if f["status"] == "OPEN" else "FILED",
                **({"filedBy": f["filed_by"], "filedAt": iso(f["filed_at"]), "reference": f["reference"] or ""} if f["status"] != "OPEN" else {}),
                **({"amount": _n(f["amount_due"])} if f["amount_due"] is not None else {})}
               for f in db.all("SELECT * FROM tax_filing WHERE org_id = ? AND kind IN ('VAT','WHT')", (org,))]

    # --- reconciliation (one branch: the signed-in user's, else the busiest one)
    branch = p.actor.branch_id or db.scalar("""SELECT branch_id FROM customer_order WHERE org_id = ? GROUP BY branch_id ORDER BY count(*) DESC LIMIT 1""", (org,)) \
        or db.scalar("SELECT id FROM branch WHERE org_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1", (org,))
    since = (today - timedelta(days=45)).isoformat()
    recon = {}
    for r in db.all("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date >= ?", (branch, since)):
        d = str(r["business_date"])[:10]
        recon[d] = {"date": d, "cashExpected": _n(r["cash_expected"]), "cashCounted": _n(r["cash_counted"]), "bankDeposit": _n(r["bank_deposit"]),
                    "bankConfirmed": bool(r["bank_confirmed"]), "telebirrExpected": _n(r["telebirr_expected"]),
                    "telebirrReceived": _n(r["telebirr_received"]), "cbeBirrExpected": _n(r["cbe_birr_expected"]),
                    "cbeBirrReceived": _n(r["cbe_birr_received"]), "status": r["status"], "note": r["note"] or "",
                    **({"reconciledBy": r["reconciled_by"], "reconciledAt": iso(r["reconciled_at"])} if r["reconciled_by"] else {})}
    exp: dict[str, dict] = {}
    for r in db.all("SELECT * FROM v_daily_payments WHERE branch_id = ? AND business_date >= ? AND business_date < ?", (branch, since, today.isoformat())):
        exp.setdefault(str(r["business_date"])[:10], {})[r["payment_method_code"]] = _n(r["amount"])
    for d, by in exp.items():
        if d not in recon:
            recon[d] = {"date": d, "cashExpected": by.get("CASH", 0), "cashCounted": 0, "bankDeposit": 0, "bankConfirmed": False,
                        "telebirrExpected": by.get("TELEBIRR", 0), "telebirrReceived": 0, "cbeBirrExpected": by.get("CBE_BIRR", 0),
                        "cbeBirrReceived": 0, "status": "PENDING", "note": ""}

    # --- money: real opening balances and movements (bill payments are rebuilt from the bills in the app)
    opening = {a: 0.0 for a in ("CASH", "BANK", "TELEBIRR", "CBE_BIRR")}
    kinds = {}
    starts = []
    for a in db.all("SELECT * FROM money_account WHERE org_id = ?", (org,)):
        acct = _ACCOUNT.get(a["kind"])
        if not acct:
            continue
        kinds[a["id"]] = acct
        opening[acct] += _n(a["opening_balance"])
        if a["opened_on"]:
            starts.append(str(a["opened_on"])[:10])
    movements = [{"date": str(m["occurred_on"])[:10], "account": kinds[m["money_account_id"]], "amount": _n(m["amount"]), "label": m["label"] or "",
                  "kind": _MOVE.get(m["kind"], "TRANSFER")}
                 for m in db.all("""SELECT * FROM cash_movement WHERE org_id = ? AND kind <> 'OPENING' AND coalesce(source_type, '') <> 'bill_payment'
                                    ORDER BY occurred_on, created_at""", (org,)) if m["money_account_id"] in kinds]
    firsts = [x for x in (sales_list[0]["date"] if sales_list else None, min((b["issueDate"] for b in bills), default=None), *starts) if x]
    start = min(firsts) if firsts else today.isoformat()
    return {"role": "FINANCE" if p.actor.role in FIN_ROLES else None, "start": start, "users": users, "vendors": vendors,
            "sales": sales_list, "bills": bills, "payroll": sorted(payroll.values(), key=lambda x: x["month"]), "filings": filings,
            "recon": sorted(recon.values(), key=lambda x: x["date"]), "reconBranch": branch,
            "deposits": {str(r["sid"]).split(":", 1)[1]: _n(r["amt"]) for r in db.all(
                """SELECT m.source_id AS sid, sum(m.amount) AS amt FROM cash_movement m JOIN money_account a ON a.id = m.money_account_id
                   WHERE m.org_id = ? AND m.source_type = 'cash_reconciliation' AND a.kind = 'BANK' AND m.source_id LIKE ? GROUP BY m.source_id""",
                (org, f"{branch}:%"))},
            "reconBranchName": db.scalar("SELECT name FROM branch WHERE id = ?", (branch,)) or branch, "opening": opening, "movements": movements}
