"""Owner dashboard (SEER Owner app): read-only roll-ups + budgets."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import services as s
from ..db import new_id, now_iso
from ..auth import hash_secret
from .admin import _check_username, _staff_code
from . import PROTECTED_ROLES, Db, Depends, Principal, get_db, require, require_owner

router = APIRouter(prefix="/owner", tags=["owner"])


class BudgetIn(BaseModel):
    category: str            # cost_category code
    allocated: float
    fixedCommitment: float | None = None


@router.get("/cash-flow")
def cash_flow(year: int, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main MonthPoint[]: {month, revenue, expenses} from the P&L view."""
    rows = db.all("""SELECT month, sum(CASE WHEN section = 'REVENUE' THEN amount ELSE 0 END) AS revenue,
                            sum(CASE WHEN section <> 'REVENUE' THEN amount ELSE 0 END) AS expenses
                     FROM v_pnl_monthly WHERE org_id = ? AND month >= ? AND month <= ? GROUP BY month ORDER BY month""",
                  (p.actor.org_id, f"{year}-01-01", f"{year}-12-01"))
    return [{"month": str(r["month"])[:7], "revenue": r["revenue"], "expenses": r["expenses"]} for r in rows]


@router.get("/balances")
def balances(p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main paymentMethods cards: Telebirr / Cash / CBE balances."""
    return db.all("SELECT kind, name, sum(balance) AS balance FROM v_account_balance WHERE org_id = ? GROUP BY kind, name", (p.actor.org_id,))


@router.get("/top-dishes")
def top_dishes(frm: str, to: str, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    return db.all("""SELECT menu_item_id, sum(quantity) AS sold, sum(total) AS revenue FROM v_sale_line
                     WHERE org_id = ? AND business_date BETWEEN ? AND ? GROUP BY menu_item_id ORDER BY revenue DESC LIMIT 10""",
                  (p.actor.org_id, frm, to))


@router.get("/peak-hours")
def peak_hours(frm: str, to: str, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    hour = "CAST(strftime('%H', datetime(created_at, '+3 hours')) AS integer)" if db.dialect == "sqlite" \
        else "extract(hour from created_at AT TIME ZONE 'Africa/Addis_Ababa')::int"
    return db.all(f"""SELECT {hour} AS hour, count(*) AS orders FROM customer_order
                      WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1""",
                  (p.actor.org_id, frm, to))


@router.get("/budgets/{month}")
def budgets(month: str, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main BudgetLine[]: allocated vs actual (from the P&L) vs last month."""
    first = f"{month}-01"
    rows = db.all("""SELECT b.cost_category_code AS category, b.allocated, b.fixed_commitment,
                            (SELECT coalesce(sum(amount),0) FROM v_pnl_monthly v WHERE v.org_id = b.org_id AND v.month = b.period_month AND v.category = b.cost_category_code) AS spent
                     FROM budget_line b WHERE b.org_id = ? AND b.period_month = ? AND b.branch_id IS NULL""", (p.actor.org_id, first))
    return rows


@router.put("/budgets/{month}")
def save_budget(month: str, body: BudgetIn, p: Principal = Depends(require_owner("owner.budget_edit")), db: Db = Depends(get_db)):
    with db.tx():
        first = f"{month}-01"
        ex = db.one("SELECT id FROM budget_line WHERE org_id = ? AND period_month = ? AND cost_category_code = ? AND branch_id IS NULL",
                    (p.actor.org_id, first, body.category))
        if ex:
            db.update("budget_line", {"id": ex["id"]}, {"allocated": body.allocated, "fixed_commitment": body.fixedCommitment, "updated_by": p.actor.user_id})
        else:
            db.insert("budget_line", {"id": new_id("bud"), "org_id": p.actor.org_id, "period_month": first, "cost_category_code": body.category,
                                      "allocated": body.allocated, "fixed_commitment": body.fixedCommitment, "updated_by": p.actor.user_id})
        s.audit(db, p.actor, "OWNER", "budget_line.save", "budget_line", f"{month}:{body.category}", "Budget {category} set to {amount}",
                {"category": body.category, "amount": body.allocated})
    return budgets(month, p, db)


# ---------- one call that fills the Owner dashboard (same shapes as ffii-main data.ts) ----------

# The dashboard's six spending groups ↔ the books' cost categories (the first one is where its budget is kept).
GROUPS = {
    "Food Cost": ["RAW_INGREDIENTS", "BEVERAGE_BAR"],
    "Labor": ["PAYROLL"],
    "Utilities": ["UTILITIES"],
    "Rent": ["RENT"],
    "Marketing": ["MARKETING"],
    "Supplies": ["KITCHEN_CONSUMABLES", "PACKAGING_DISPOSABLES", "CLEANING_SANITATION", "REPAIRS", "FEES", "OTHER_OPEX"],
}
GROUP_OF = {c: g for g, cs in GROUPS.items() for c in cs}
OWNER_ROLES = {"OWNER"}


def _f(v) -> float:
    return float(v or 0)


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


@router.get("/bootstrap")
def owner_bootstrap(p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    org = p.actor.org_id
    today = date.fromisoformat(s.business_date())
    this_m, last_m = _month_start(today), _add_months(_month_start(today), -1)
    year_start = date(today.year, 1, 1)
    org_row = db.one("SELECT * FROM organization WHERE id = ?", (org,)) or {}
    me = db.one("SELECT full_name, email FROM app_user WHERE id = ?", (p.actor.user_id,)) or {}

    # --- daily net revenue: closed Z-reports, plus days the till never closed
    rev: dict[str, float] = {}
    orders: dict[str, int] = {}
    closed = set()
    for r in db.all("SELECT * FROM daily_sales_summary WHERE org_id = ? AND business_date >= ?", (org, _add_months(year_start, -1).isoformat())):
        d = str(r["business_date"])[:10]
        closed.add((r["branch_id"], d))
        rev[d] = rev.get(d, 0) + _f(r["gross"]) - _f(r["vat"])
        orders[d] = orders.get(d, 0) + int(r["order_count"] or 0)
    for r in db.all("SELECT * FROM v_daily_sales_live WHERE org_id = ? AND business_date >= ? AND gross IS NOT NULL",
                    (org, _add_months(year_start, -1).isoformat())):
        d = str(r["business_date"])[:10]
        if (r["branch_id"], d) in closed:
            continue
        rev[d] = rev.get(d, 0) + _f(r["gross"]) - _f(r["vat"])
        orders[d] = orders.get(d, 0) + int(r["order_count"] or 0)

    # --- costs by month and group (the P&L view), and by day for the charts
    costs: dict[str, dict[str, float]] = {}
    for r in db.all("""SELECT month, category, sum(amount) AS amount FROM v_pnl_monthly WHERE org_id = ? AND section <> 'REVENUE' AND month >= ?
                       GROUP BY month, category""", (org, _add_months(year_start, -1).isoformat())):
        m = str(r["month"])[:7]
        g = GROUP_OF.get(r["category"], "Food Cost" if r["category"] not in GROUP_OF and r["category"] else "Supplies")   # waste reasons → food cost
        costs.setdefault(m, {}).setdefault(g, 0)
        costs[m][g] += _f(r["amount"])
    # The P&L counts a purchase once a manager approves it. The owner wants money already spent,
    # so purchases still waiting for review count here too (rejected ones don't).
    for r in db.all("""SELECT business_date, cost_category_code AS category, sum(total_cost - vat_amount) AS amount FROM purchase p
                       WHERE org_id = ? AND review_status = 'PENDING' AND deleted_at IS NULL AND business_date >= ?
                         AND NOT EXISTS (SELECT 1 FROM bill_line bl WHERE bl.purchase_id = p.id)
                       GROUP BY business_date, cost_category_code""", (org, _add_months(year_start, -1).isoformat())):
        m = str(r["business_date"])[:7]
        g = GROUP_OF.get(r["category"], "Food Cost" if r["category"] not in GROUP_OF and r["category"] else "Supplies")
        costs.setdefault(m, {}).setdefault(g, 0)
        costs[m][g] += _f(r["amount"])
    month_cost = lambda m: sum(costs.get(m, {}).values())
    month_rev = lambda m: sum(v for d, v in rev.items() if d.startswith(m))

    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    cash_flow = [{"month": names[i], "revenue": round(month_rev(f"{today.year}-{i + 1:02d}")), "expenses": round(month_cost(f"{today.year}-{i + 1:02d}"))}
                 for i in range(12)]

    daily_cost: dict[str, float] = {}
    for sql in ("SELECT business_date AS d, sum(total_cost - vat_amount) AS a FROM purchase WHERE org_id = ? AND review_status IN ('PENDING','APPROVED') AND deleted_at IS NULL AND business_date >= ? GROUP BY business_date",
                "SELECT business_date AS d, sum(amount - vat_amount) AS a FROM expense WHERE org_id = ? AND deleted_at IS NULL AND review_status IN ('PENDING','APPROVED') AND business_date >= ? GROUP BY business_date",
                "SELECT business_date AS d, sum(loss_value) AS a FROM waste_report WHERE org_id = ? AND approval_status = 'APPROVED' AND deleted_at IS NULL AND business_date >= ? GROUP BY business_date",
                "SELECT issue_date AS d, sum(subtotal) AS a FROM bill WHERE org_id = ? AND status <> 'VOID' AND source <> 'PURCHASE' AND issue_date >= ? GROUP BY issue_date"):
        for r in db.all(sql, (org, (today - timedelta(days=70)).isoformat())):
            d = str(r["d"])[:10]
            daily_cost[d] = daily_cost.get(d, 0) + _f(r["a"])
    pay = {str(r["period_month"])[:7]: _f(r["g"]) for r in db.all(
        "SELECT period_month, sum(total_gross + total_pension_employer) AS g FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') GROUP BY period_month", (org,))}
    last_pay = pay[max(pay)] if pay else 0

    def day_cost(d: date) -> float:
        days = ((_add_months(_month_start(d), 1)) - timedelta(days=1)).day
        return daily_cost.get(d.isoformat(), 0) + pay.get(d.isoformat()[:7], last_pay) / days

    daily = [{"date": (today - timedelta(days=6 - i)).isoformat(), "revenue": round(rev.get((today - timedelta(days=6 - i)).isoformat(), 0)),
              "expenses": round(day_cost(today - timedelta(days=6 - i)))} for i in range(7)]
    monday = today - timedelta(days=today.weekday())
    weekly = []
    for i in range(8):
        start = monday - timedelta(days=(7 - i) * 7)
        days = [start + timedelta(days=k) for k in range(7) if start + timedelta(days=k) <= today]
        weekly.append({"start": start.isoformat(), "revenue": round(sum(rev.get(d.isoformat(), 0) for d in days)),
                       "expenses": round(sum(day_cost(d) for d in days))})

    # --- this month so far, against the same days of last month (the dashboard's headline cards)
    def _span(first: date, last: date) -> list[date]:
        return [first + timedelta(days=k) for k in range((last - first).days + 1)] if last >= first else []
    last_m_end = this_m - timedelta(days=1)
    mtd_days = _span(this_m, today)
    prev_days = _span(last_m, min(last_m.replace(day=min(today.day, last_m_end.day)), last_m_end))
    month_to_date = {"days": len(mtd_days),
                     "revenue": round(sum(rev.get(d.isoformat(), 0) for d in mtd_days)),
                     "expenses": round(sum(day_cost(d) for d in mtd_days)),
                     "orders": sum(orders.get(d.isoformat(), 0) for d in mtd_days),
                     "today": round(rev.get(today.isoformat(), 0)),
                     "prevRevenue": round(sum(rev.get(d.isoformat(), 0) for d in prev_days)),
                     "prevExpenses": round(sum(day_cost(d) for d in prev_days))}

    # --- money: Telebirr wallet, cash (safe, drawers, petty cash), CBE (bank + CBE Birr)
    card = {"TELEBIRR": "telebirr", "SAFE": "cash", "CASH_DRAWER": "cash", "PETTY_CASH": "cash", "BANK": "cbe", "CBE_BIRR": "cbe"}
    accts = {a["id"]: a for a in db.all("SELECT * FROM money_account WHERE org_id = ?", (org,))}
    cards = {k: {"id": k, "name": {"telebirr": "Telebirr", "cash": "Cash", "cbe": "CBE"}[k], "balance": 0.0, "before": 0.0, "account": "",
                 "spent": 0.0, "moneyIn": 0.0, "lastOut": 0.0, "activity": []} for k in ("telebirr", "cash", "cbe")}
    for a in accts.values():
        k = card.get(a["kind"])
        if not k:
            continue
        cards[k]["balance"] += _f(a["opening_balance"]); cards[k]["before"] += _f(a["opening_balance"])
        if a["account_ref"] and not cards[k]["account"] and a["kind"] in ("TELEBIRR", "BANK", "SAFE"):
            cards[k]["account"] = a["account_ref"]
    month_ago = (today - timedelta(days=30)).isoformat()
    for m in db.all("SELECT * FROM cash_movement WHERE org_id = ? AND kind <> 'OPENING' ORDER BY occurred_on DESC, created_at DESC", (org,)):
        a = accts.get(m["money_account_id"])
        k = card.get(a["kind"]) if a else None
        if not k:
            continue
        amt, d = _f(m["amount"]), str(m["occurred_on"])[:10]
        c = cards[k]
        c["balance"] += amt
        if d <= month_ago:
            c["before"] += amt
        if d >= this_m.isoformat():
            if amt < 0: c["spent"] += -amt
            else: c["moneyIn"] += amt
        elif d >= last_m.isoformat() and amt < 0:
            c["lastOut"] += -amt
        if len(c["activity"]) < 3 and m["kind"] not in ("DEPOSIT", "TRANSFER"):
            c["activity"].append({"label": m["label"] or m["kind"].title(), "date": d, "amount": round(amt, 2)})
    payment_methods = {}
    for k, c in cards.items():
        change = round((c["balance"] - c["before"]) / abs(c["before"]) * 100, 1) if c["before"] else 0
        payment_methods[k] = {"id": k, "name": c["name"], "balance": round(c["balance"], 2), "change": change,
                              "account": c["account"] or {"cash": "Safe & drawers", "telebirr": "Merchant wallet", "cbe": "Bank account"}[k],
                              "spent": round(c["spent"]), "limit": round(max(c["lastOut"], c["spent"], 1)), "moneyIn": round(c["moneyIn"]),
                              "activity": c["activity"]}

    # --- transactions, newest first: sales (counter and table bills), purchases, bills, expenses, payroll
    since90 = (today - timedelta(days=90)).isoformat()
    names_en = {r["key"]: r["text"] for r in db.all("SELECT key, text FROM i18n_text WHERE lang = 'en' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,))}
    branches = {r["id"]: r["name"] for r in db.all("SELECT id, name FROM branch WHERE org_id = ?", (org,))}
    where = (lambda b: f" · {branches.get(b, b)}") if len(branches) > 1 else (lambda b: "")
    METHOD = {"CASH": "Cash", "TELEBIRR": "Telebirr", "CBE_BIRR": "CBE Birr", "MPESA": "M-Pesa", "CARD": "Card", "BANK_TRANSFER": "Bank transfer"}
    short = lambda prefix, i: f"{prefix}-{str(i)[-6:].upper()}"
    tx = []
    for o in db.all("""SELECT o.id, o.order_number, o.receipt_no, o.branch_id, o.order_type, o.table_number, o.total_gross, o.paid_at, o.business_date,
                              t.name AS table_name, (SELECT min(op.payment_method_code) FROM order_payment op WHERE op.order_id = o.id) AS method
                       FROM customer_order o LEFT JOIN dining_table t ON t.id = o.table_id
                       WHERE o.org_id = ? AND o.status = 'PAID' AND o.business_date >= ? ORDER BY o.paid_at DESC LIMIT 400""", (org, since90)):
        table = o["table_name"] or o["table_number"]
        what = f"Table {table}" if table else ("Takeaway" if o["order_type"] in ("TAKEOUT", "TAKEAWAY") else "Counter sale")
        tx.append({"id": o["receipt_no"] or f"ORD-{o['order_number']}", "description": f"Order {o['order_number']} · {what}"
                   + (f" · {METHOD.get(o['method'], o['method'])}" if o["method"] else "") + where(o["branch_id"]),
                   "category": "Sales", "date": str(o["business_date"])[:10], "at": s._iso(o["paid_at"]) if o["paid_at"] else str(o["business_date"]),
                   "amount": round(_f(o["total_gross"]), 2), "status": "Success"})
    PURCHASE_STATUS = {"APPROVED": "Success", "REJECTED": "Failed"}
    for r in db.all("""SELECT p.id, p.branch_id, p.quantity, p.unit_code, p.total_cost, p.vendor_name, p.payment_method_code, p.cost_category_code,
                              p.purchased_at, p.business_date, p.review_status, i.custom_name, i.name_key
                       FROM purchase p JOIN inventory_item i ON i.id = p.item_id
                       WHERE p.org_id = ? AND p.deleted_at IS NULL AND p.business_date >= ? ORDER BY p.purchased_at DESC LIMIT 300""", (org, since90)):
        item = r["custom_name"] or names_en.get(r["name_key"], r["name_key"])
        qty = _f(r["quantity"])
        vendor = r["vendor_name"] if r["vendor_name"] and r["vendor_name"] != "Unknown vendor" else ""
        tx.append({"id": short("PUR", r["id"]), "description": f"{item} · {qty:g} {r['unit_code']}" + (f" · {vendor}" if vendor else "")
                   + (f" · {METHOD.get(r['payment_method_code'], r['payment_method_code'])}" if r["payment_method_code"] else "") + where(r["branch_id"]),
                   "category": GROUP_OF.get(r["cost_category_code"], "Food Cost"), "date": str(r["business_date"])[:10],
                   "at": s._iso(r["purchased_at"]) if r["purchased_at"] else str(r["business_date"]),
                   "amount": -round(_f(r["total_cost"]), 2), "status": PURCHASE_STATUS.get(r["review_status"], "Pending")})
    for b in db.all("""SELECT * FROM v_bill_status WHERE org_id = ? AND display_status NOT IN ('VOID','DRAFT') AND issue_date >= ?
                       AND (source IS NULL OR source <> 'PURCHASE') ORDER BY issue_date DESC LIMIT 120""", (org, since90)):
        st = {"PAID": "Success", "OVERDUE": "Failed"}.get(b["display_status"], "Pending")
        tx.append({"id": b["bill_no"] or short("BILL", b["id"]), "description": f"{b['vendor_name']}" + (f" · {b['description']}" if b["description"] and len(b["description"]) < 40 else ""),
                   "category": GROUP_OF.get(b["cost_category_code"], "Supplies"), "date": str(b["issue_date"])[:10], "at": str(b["issue_date"])[:10],
                   "amount": -round(_f(b["total"]), 2), "status": st})
    for e in db.all("SELECT * FROM expense WHERE org_id = ? AND deleted_at IS NULL AND business_date >= ? ORDER BY spent_at DESC LIMIT 120", (org, since90)):
        tx.append({"id": short("EXP", e["id"]), "description": e["reason"] + (f" · {METHOD.get(e['payment_method_code'], e['payment_method_code'])}" if e["payment_method_code"] else "")
                   + where(e["branch_id"]),
                   "category": GROUP_OF.get(e["cost_category_code"], "Supplies"), "date": str(e["business_date"])[:10],
                   "at": s._iso(e["spent_at"]) if e["spent_at"] else str(e["business_date"]),
                   "amount": -round(_f(e["amount"]), 2), "status": "Failed" if e["review_status"] == "REJECTED" else "Success"})
    for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') ORDER BY period_month DESC LIMIT 6", (org,)):
        m = str(r["period_month"])[:7]
        d = str(r["paid_on"] or r["approved_at"] or r["period_month"])[:10]
        tx.append({"id": f"PAY-{m}", "description": f"Staff payroll {m}", "category": "Labor", "date": d, "at": d,
                   "amount": -round(_f(r["total_gross"]) + _f(r["total_pension_employer"]), 2), "status": "Success" if r["status"] == "PAID" else "Pending"})
    tx.sort(key=lambda x: x["at"], reverse=True)

    # --- analytics: this month (or the last 30 days when the month has just started)
    frm = this_m if today.day >= 7 else today - timedelta(days=30)
    dishes = db.all("""SELECT l.menu_item_id AS id, m.name_key, sum(l.quantity) AS sold, sum(l.total) AS revenue FROM v_sale_line l
                       JOIN menu_item m ON m.id = l.menu_item_id WHERE l.org_id = ? AND l.business_date >= ? GROUP BY l.menu_item_id, m.name_key
                       ORDER BY revenue DESC""", (org, frm.isoformat()))
    total = sum(_f(d["revenue"]) for d in dishes) or 1
    top = [{"name": names_en.get(d["name_key"], d["id"]), "sold": int(_f(d["sold"])), "revenue": round(_f(d["revenue"])),
            "pct": round(_f(d["revenue"]) / total * 100)} for d in dishes[:5]]
    hour = "CAST(strftime('%H', datetime(paid_at, '+3 hours')) AS integer)" if db.dialect == "sqlite" \
        else "extract(hour from paid_at AT TIME ZONE 'Africa/Addis_Ababa')::int"
    hours = db.all(f"""SELECT {hour} AS hour, count(*) AS orders FROM customer_order WHERE org_id = ? AND status = 'PAID' AND paid_at IS NOT NULL
                       AND business_date >= ? GROUP BY 1 ORDER BY 2 DESC LIMIT 6""", (org, frm.isoformat()))
    peak = [{"hour": f"{int(h['hour']):02d}–{(int(h['hour']) + 1) % 24:02d}", "orders": int(h["orders"])} for h in sorted(hours, key=lambda h: int(h["hour"]))]

    # --- budgets for this month
    alloc = {}
    for b in db.all("SELECT * FROM budget_line WHERE org_id = ? AND period_month = ? AND branch_id IS NULL", (org, this_m.isoformat())):
        g = GROUP_OF.get(b["cost_category_code"])
        if g:
            alloc.setdefault(g, {"allocated": 0.0, "fixed": None})
            alloc[g]["allocated"] += _f(b["allocated"])
            if b["fixed_commitment"] is not None:
                alloc[g]["fixed"] = _f(b["fixed_commitment"])
    tm, lm = this_m.isoformat()[:7], last_m.isoformat()[:7]
    rent_paid = db.scalar("SELECT min(paid_on) FROM bill_payment bp JOIN bill b ON b.id = bp.bill_id WHERE b.org_id = ? AND b.cost_category_code = 'RENT' AND bp.paid_on >= ?",
                          (org, this_m.isoformat()))
    budgets = []
    for g in GROUPS:
        last = round(costs.get(lm, {}).get(g, 0))
        a = alloc.get(g, {}).get("allocated")
        line = {"category": g, "code": GROUPS[g][0], "allocated": round(a if a is not None else max(last, 1)), "spent": round(costs.get(tm, {}).get(g, 0)),
                "lastMonth": last, "set": a is not None}
        if g == "Rent":
            committed = alloc.get(g, {}).get("fixed") or line["allocated"]
            line["fixed"] = {"committed": round(committed), "paidOn": str(rent_paid)[:10] if rent_paid else None}
        budgets.append(line)

    # --- goals from real figures
    cur_rev = month_rev(tm)
    last_rev = month_rev(lm)
    food = costs.get(tm, {}).get("Food Cost", 0)
    aov = db.one("""SELECT count(*) AS n, coalesce(sum(total_gross), 0) AS g FROM customer_order WHERE org_id = ? AND status = 'PAID' AND business_date >= ?""",
                 (org, frm.isoformat()))
    n_orders, gross_m = int(aov["n"] or 0), aov["g"]
    month_end = (_add_months(this_m, 1) - timedelta(days=1)).isoformat()
    saved = {r["goal_key"]: _f(r["target"]) for r in db.all("SELECT goal_key, target FROM owner_goal_target WHERE org_id = ?", (org,))}
    auto = {"revenue": round(max(last_rev * 1.1, 1) / 1000) * 1000 or 1000, "foodCost": 30, "aov": 480}
    target = lambda k: saved.get(k, auto[k])
    goals = [
        {"key": "revenue", "title": "Monthly Revenue Target", "current": round(cur_rev), "target": round(target("revenue")), "unit": "ETB",
         "deadline": month_end, "custom": "revenue" in saved},
        {"key": "foodCost", "title": "Food Cost under 30%", "current": round(food / cur_rev * 100, 1) if cur_rev else 0, "target": target("foodCost"),
         "unit": "%", "deadline": month_end, "lowerIsBetter": True, "custom": "foodCost" in saved},
        {"key": "aov", "title": "Average Order Value", "current": round(_f(gross_m) / n_orders) if n_orders else 0,
         "target": round(target("aov")), "unit": "ETB", "deadline": month_end, "custom": "aov" in saved},
    ]
    investments = [_investment(r) for r in db.all(
        "SELECT * FROM owner_investment WHERE org_id = ? AND deleted_at IS NULL ORDER BY coalesce(target_date, '9999-12-31'), created_at", (org,))]
    return {"role": p.actor.role if p.actor.role in OWNER_ROLES else None,
            "user": {"name": me.get("full_name", ""), "email": me.get("email") or "", "restaurant": org_row.get("trade_name") or org_row.get("legal_name") or ""},
            "cashFlow": cash_flow, "daily": daily, "weekly": weekly, "monthToDate": month_to_date, "paymentMethods": payment_methods, "transactions": tx[:400],
            "topDishes": top, "peakHours": peak, "budgets": budgets, "goals": goals,
            "investments": investments}


class GroupBudgetIn(BaseModel):
    group: str               # "Food Cost", "Labor", … (the dashboard's spending groups)
    allocated: float


@router.put("/budget-groups/{month}")
def save_group_budget(month: str, body: GroupBudgetIn, p: Principal = Depends(require_owner("owner.budget_edit")), db: Db = Depends(get_db)):
    """Set a dashboard group's monthly budget: kept on the group's main cost category, the others in the group cleared."""
    codes = GROUPS.get(body.group)
    if not codes:
        raise s.Invalid("unknown budget group", group=body.group)
    if not 0 <= body.allocated <= 10_000_000:
        raise s.Invalid("budget must be between 0 and 10,000,000")
    first = f"{month[:7]}-01"
    with db.tx():
        for code in codes[1:]:
            db.execute("DELETE FROM budget_line WHERE org_id = ? AND period_month = ? AND cost_category_code = ? AND branch_id IS NULL",
                       (p.actor.org_id, first, code))
        ex = db.one("SELECT id FROM budget_line WHERE org_id = ? AND period_month = ? AND cost_category_code = ? AND branch_id IS NULL",
                    (p.actor.org_id, first, codes[0]))
        fixed = body.allocated if body.group == "Rent" else None
        if ex:
            db.update("budget_line", {"id": ex["id"]}, {"allocated": body.allocated, "fixed_commitment": fixed, "updated_by": p.actor.user_id})
        else:
            db.insert("budget_line", {"id": new_id("bud"), "org_id": p.actor.org_id, "period_month": first, "cost_category_code": codes[0],
                                      "allocated": body.allocated, "fixed_commitment": fixed, "updated_by": p.actor.user_id})
        s.audit(db, p.actor, "OWNER", "budget_line.save", "budget_line", f"{month[:7]}:{body.group}", "Budget {group} set to {amount}",
                {"group": body.group, "amount": body.allocated})
        return {"group": body.group, "allocated": body.allocated}


# ---------------------------------------------------------------- System Admin accounts
# The chain of trust: the Owner creates the System Admins; the System Admins create everyone else.

class AdminIn(BaseModel):
    fullName: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    branchId: str
    phone: str | None = None
    isActive: bool = True
    password: str | None = Field(default=None, min_length=8)


def _admin_row(db: Db, uid: str) -> dict:
    return db.one("""SELECT id, staff_code, full_name, username, home_branch_id, phone, is_active, last_login_at, created_at
                     FROM app_user WHERE id = ?""", (uid,)) or {}


@router.get("/admins")
def list_admins(p: Principal = Depends(require_owner()), db: Db = Depends(get_db)):
    org = p.actor.org_id
    admins = db.all("""SELECT id, staff_code, full_name, username, home_branch_id, phone, is_active, last_login_at, created_at
                       FROM app_user WHERE org_id = ? AND role_code = 'ADMIN' AND deleted_at IS NULL ORDER BY full_name""", (org,))
    branches = db.all("SELECT id, name FROM branch WHERE org_id = ? ORDER BY name", (org,))
    return {"admins": admins, "branches": branches}


@router.post("/admins", status_code=201)
def add_admin(body: AdminIn, p: Principal = Depends(require_owner()), db: Db = Depends(get_db)):
    if not body.password:
        raise s.Invalid("a new System Admin needs a password (at least 8 characters)")
    with db.tx():
        uid = new_id("usr")
        _check_username(db, p.actor.org_id, body.username, uid)
        if not db.scalar("SELECT 1 FROM branch WHERE org_id = ? AND id = ?", (p.actor.org_id, body.branchId)):
            raise s.Invalid("unknown branch", branch=body.branchId)
        db.insert("app_user", {"id": uid, "org_id": p.actor.org_id, "full_name": body.fullName.strip(), "username": body.username.lower(),
                               "role_code": "ADMIN", "home_branch_id": body.branchId, "phone": body.phone, "is_active": body.isActive,
                               "initials": "".join(w[0] for w in body.fullName.split()[:2]).upper(),
                               "staff_code": _staff_code(db, p.actor.org_id, "ADMIN"), "password_hash": hash_secret(body.password)})
        s.audit(db, p.actor, "OWNER", "app_user.create", "app_user", uid, "User {name} created as {role}",
                {"name": body.fullName, "role": "ADMIN"})
        return _admin_row(db, uid)


@router.put("/admins/{uid}")
def edit_admin(uid: str, body: AdminIn, p: Principal = Depends(require_owner()), db: Db = Depends(get_db)):
    with db.tx():
        u = db.one("SELECT * FROM app_user WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (uid, p.actor.org_id))
        if not u or u["role_code"] != "ADMIN":
            raise s.NotFound("System Admin not found")
        _check_username(db, p.actor.org_id, body.username, uid)
        changes = {"full_name": body.fullName.strip(), "username": body.username.lower(), "home_branch_id": body.branchId,
                   "phone": body.phone, "is_active": body.isActive}
        if body.password:
            changes.update(password_hash=hash_secret(body.password), failed_logins=0, locked_until=None)
        db.update("app_user", {"id": uid}, changes)
        if not body.isActive or body.password:      # sign them out everywhere
            db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), uid))
        what = ("app_user.password_reset" if body.password else
                "app_user.deactivate" if u["is_active"] and not body.isActive else
                "app_user.reactivate" if not u["is_active"] and body.isActive else "app_user.update")
        text = {"app_user.password_reset": "Set a new password for {name}", "app_user.deactivate": "Deactivated {name}",
                "app_user.reactivate": "Reactivated {name}"}.get(what, "Edited account {name}")
        s.audit(db, p.actor, "OWNER", what, "app_user", uid, text, {"name": body.fullName},
                before={"active": bool(u["is_active"])}, after={"active": body.isActive})
        return _admin_row(db, uid)


# ---------- Goals: targets the owner sets ----------

GOAL_KEYS = {"revenue", "foodCost", "aov"}


class GoalIn(BaseModel):
    target: float = Field(gt=0, le=1_000_000_000)


@router.put("/goals/{key}")
def set_goal(key: str, body: GoalIn, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    if key not in GOAL_KEYS:
        raise s.NotFound("unknown goal")
    if key == "foodCost" and body.target > 100:
        raise s.Invalid("food cost target is a percentage (0–100)")
    with db.tx():
        if db.scalar("SELECT 1 FROM owner_goal_target WHERE org_id = ? AND goal_key = ?", (p.actor.org_id, key)):
            db.execute("UPDATE owner_goal_target SET target = ?, updated_by = ?, updated_at = ? WHERE org_id = ? AND goal_key = ?",
                       (body.target, p.actor.user_id, now_iso(), p.actor.org_id, key))
        else:
            db.insert("owner_goal_target", {"org_id": p.actor.org_id, "goal_key": key, "target": body.target, "updated_by": p.actor.user_id})
        s.audit(db, p.actor, "OWNER", "goal.update", "owner_goal_target", key, "Goal {goal} set to {target}", {"goal": key, "target": body.target})
    return {"key": key, "target": body.target}


@router.delete("/goals/{key}")
def reset_goal(key: str, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    """Back to the automatic target."""
    with db.tx():
        db.execute("DELETE FROM owner_goal_target WHERE org_id = ? AND goal_key = ?", (p.actor.org_id, key))
    return {"key": key, "reset": True}


# ---------- Investments: plans the owner is saving for ----------

INVESTMENT_KINDS = {"EQUIPMENT", "EXPANSION", "RENOVATION", "VEHICLE", "OTHER"}


def _investment(r: dict) -> dict:
    return {"id": r["id"], "title": r["title"], "kind": r["kind"], "target": _f(r["target_amount"]), "saved": _f(r["saved_amount"]),
            "targetDate": str(r["target_date"])[:10] if r["target_date"] else None, "note": r["note"] or ""}


class InvestmentIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: str = "OTHER"
    target: float = Field(ge=0, le=1_000_000_000)
    saved: float = Field(default=0, ge=0, le=1_000_000_000)
    targetDate: date | None = None
    note: str | None = Field(default=None, max_length=500)


def _check_kind(kind: str) -> str:
    k = kind.upper()
    if k not in INVESTMENT_KINDS:
        raise s.Invalid("unknown investment type")
    return k


@router.get("/investments")
def list_investments(p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    return [_investment(r) for r in db.all("SELECT * FROM owner_investment WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at", (p.actor.org_id,))]


@router.post("/investments", status_code=201)
def add_investment(body: InvestmentIn, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    with db.tx():
        iid = new_id("invp")
        db.insert("owner_investment", {"id": iid, "org_id": p.actor.org_id, "title": body.title.strip(), "kind": _check_kind(body.kind),
                                       "target_amount": body.target, "saved_amount": body.saved,
                                       "target_date": body.targetDate.isoformat() if body.targetDate else None,
                                       "note": (body.note or "").strip() or None, "created_by": p.actor.user_id})
        s.audit(db, p.actor, "OWNER", "investment.create", "owner_investment", iid, "New investment plan {title}", {"title": body.title})
        return _investment(db.one("SELECT * FROM owner_investment WHERE id = ?", (iid,)))


@router.put("/investments/{iid}")
def edit_investment(iid: str, body: InvestmentIn, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    with db.tx():
        if not db.scalar("SELECT 1 FROM owner_investment WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (iid, p.actor.org_id)):
            raise s.NotFound("investment plan not found")
        db.execute("""UPDATE owner_investment SET title = ?, kind = ?, target_amount = ?, saved_amount = ?, target_date = ?, note = ?, updated_at = ?
                      WHERE id = ?""", (body.title.strip(), _check_kind(body.kind), body.target, body.saved,
                                        body.targetDate.isoformat() if body.targetDate else None, (body.note or "").strip() or None, now_iso(), iid))
        s.audit(db, p.actor, "OWNER", "investment.update", "owner_investment", iid, "Updated investment plan {title}", {"title": body.title})
        return _investment(db.one("SELECT * FROM owner_investment WHERE id = ?", (iid,)))


@router.delete("/investments/{iid}")
def delete_investment(iid: str, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    with db.tx():
        row = db.one("SELECT * FROM owner_investment WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (iid, p.actor.org_id))
        if not row:
            raise s.NotFound("investment plan not found")
        db.execute("UPDATE owner_investment SET deleted_at = ? WHERE id = ?", (now_iso(), iid))
        s.audit(db, p.actor, "OWNER", "investment.delete", "owner_investment", iid, "Removed investment plan {title}", {"title": row["title"]})
    return {"id": iid, "deleted": True}



# ---------- Reports: every card on the Reports tab, as rows the app turns into a CSV ----------

REPORT_KEYS = {"daily-sales", "weekly-pnl", "monthly-tax", "inventory", "staff", "menu"}


def _month_bounds(month: str | None, today: date) -> tuple[date, date]:
    try:
        first = date.fromisoformat(f"{month}-01") if month else _month_start(today)
    except ValueError:
        raise s.Invalid("month must look like 2026-11")
    last = _add_months(first, 1) - timedelta(days=1)
    return first, min(last, today) if first <= today else last


def _hours(a, b) -> float:
    from datetime import datetime
    if not a or not b:
        return 0.0
    try:
        x = datetime.fromisoformat(str(a).replace("Z", "+00:00"))
        y = datetime.fromisoformat(str(b).replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return max(0.0, (y - x).total_seconds() / 3600)


@router.get("/reports/{key}")
def report(key: str, month: str | None = None, p: Principal = Depends(require_owner("owner.dashboard")), db: Db = Depends(get_db)):
    """{title, filename, columns, rows}: the Owner app downloads it as a CSV."""
    if key not in REPORT_KEYS:
        raise s.NotFound("unknown report")
    org = p.actor.org_id
    today = date.fromisoformat(s.business_date())
    a, b = _month_bounds(month, today)
    ym = a.isoformat()[:7]
    rows: list[list] = []

    if key == "daily-sales":
        cols = ["Date", "Orders", "Gross sales (incl. VAT)", "VAT", "Net sales", "Average ticket", "Cash", "Telebirr", "CBE Birr", "Other"]
        days = {str(r["d"])[:10]: r for r in db.all("""SELECT business_date AS d, count(*) AS n, sum(total_gross) AS g, sum(vat_amount) AS v FROM customer_order
                                                       WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ? GROUP BY business_date""",
                                                    (org, a.isoformat(), b.isoformat()))}
        mix: dict[str, dict[str, float]] = {}
        for r in db.all("""SELECT o.business_date AS d, op.payment_method_code AS m, sum(op.amount) AS amt FROM order_payment op JOIN customer_order o ON o.id = op.order_id
                           WHERE o.org_id = ? AND o.status = 'PAID' AND op.status = 'CAPTURED' AND o.business_date BETWEEN ? AND ? GROUP BY 1, 2""",
                        (org, a.isoformat(), b.isoformat())):
            mix.setdefault(str(r["d"])[:10], {})[r["m"]] = _f(r["amt"])
        tot = [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        d = a
        while d <= b:
            k = d.isoformat()
            r = days.get(k)
            n, g, v = (int(r["n"]), _f(r["g"]), _f(r["v"])) if r else (0, 0.0, 0.0)
            m = mix.get(k, {})
            cash, tb, cbe = m.get("CASH", 0), m.get("TELEBIRR", 0), m.get("CBE_BIRR", 0)
            other = sum(m.values()) - cash - tb - cbe
            rows.append([k, n, round(g, 2), round(v, 2), round(g - v, 2), round(g / n, 2) if n else 0, round(cash, 2), round(tb, 2), round(cbe, 2), round(other, 2)])
            for i, x in enumerate((n, g, v, g - v, cash, tb, cbe, other)):
                tot[i] += x
            d += timedelta(days=1)
        rows.append(["Total", tot[0], round(tot[1], 2), round(tot[2], 2), round(tot[3], 2), round(tot[1] / tot[0], 2) if tot[0] else 0,
                     round(tot[4], 2), round(tot[5], 2), round(tot[6], 2), round(tot[7], 2)])
        title = f"Daily sales {ym}"

    elif key == "weekly-pnl":
        cols = ["Week starting", "Net sales", *GROUPS.keys(), "Waste", "Total costs", "Profit", "Margin %"]
        start = today - timedelta(days=today.weekday()) - timedelta(weeks=11)
        frm = start.isoformat()
        day: dict[str, dict[str, float]] = {}
        def add(dd, group, amt):
            day.setdefault(str(dd)[:10], {}).setdefault(group, 0.0)
            day[str(dd)[:10]][group] += _f(amt)
        for r in db.all("SELECT business_date AS d, sum(total_gross - vat_amount) AS a FROM customer_order WHERE org_id = ? AND status = 'PAID' AND business_date >= ? GROUP BY 1", (org, frm)):
            add(r["d"], "_sales", r["a"])
        for sql in ("SELECT business_date AS d, cost_category_code AS c, sum(total_cost - vat_amount) AS a FROM purchase WHERE org_id = ? AND deleted_at IS NULL AND review_status IN ('PENDING','APPROVED') AND business_date >= ? GROUP BY 1, 2",
                    "SELECT business_date AS d, cost_category_code AS c, sum(amount - vat_amount) AS a FROM expense WHERE org_id = ? AND deleted_at IS NULL AND review_status IN ('PENDING','APPROVED') AND business_date >= ? GROUP BY 1, 2",
                    "SELECT issue_date AS d, cost_category_code AS c, sum(subtotal) AS a FROM bill WHERE org_id = ? AND status <> 'VOID' AND source <> 'PURCHASE' AND issue_date >= ? GROUP BY 1, 2"):
            for r in db.all(sql, (org, frm)):
                add(r["d"], GROUP_OF.get(r["c"], "Supplies"), r["a"])
        for r in db.all("SELECT business_date AS d, sum(loss_value) AS a FROM waste_report WHERE org_id = ? AND approval_status = 'APPROVED' AND deleted_at IS NULL AND business_date >= ? GROUP BY 1", (org, frm)):
            add(r["d"], "Waste", r["a"])
        for r in db.all("SELECT period_month, sum(total_gross + total_pension_employer) AS g FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') GROUP BY period_month", (org,)):
            first = _month_start(date.fromisoformat(str(r["period_month"])[:10]))
            n = ((_add_months(first, 1) - timedelta(days=1)) - first).days + 1
            for i in range(n):
                dd = first + timedelta(days=i)
                if dd >= start:
                    add(dd, "Labor", _f(r["g"]) / n)
        for w in range(12):
            ws = start + timedelta(weeks=w)
            agg: dict[str, float] = {}
            for i in range(7):
                for g, v in day.get((ws + timedelta(days=i)).isoformat(), {}).items():
                    agg[g] = agg.get(g, 0) + v
            sales = agg.pop("_sales", 0.0)
            costs_ = [round(agg.get(g, 0), 2) for g in GROUPS] + [round(agg.get("Waste", 0), 2)]
            total = sum(costs_)
            rows.append([ws.isoformat(), round(sales, 2), *costs_, round(total, 2), round(sales - total, 2), round((sales - total) / sales * 100, 1) if sales else 0])
        title = "Weekly profit & loss (last 12 weeks)"

    elif key == "monthly-tax":
        cols = ["Item", "Amount (ETB)", "Note"]
        out_vat = _f(db.scalar("SELECT coalesce(sum(vat_amount), 0) FROM customer_order WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        sales_net = _f(db.scalar("SELECT coalesce(sum(total_gross - vat_amount), 0) FROM customer_order WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        in_pur = _f(db.scalar("SELECT coalesce(sum(vat_amount), 0) FROM purchase WHERE org_id = ? AND deleted_at IS NULL AND review_status <> 'REJECTED' AND has_vat_receipt AND business_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        in_exp = _f(db.scalar("SELECT coalesce(sum(vat_amount), 0) FROM expense WHERE org_id = ? AND deleted_at IS NULL AND review_status <> 'REJECTED' AND has_vat_receipt AND business_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        in_bill = _f(db.scalar("SELECT coalesce(sum(vat), 0) FROM bill WHERE org_id = ? AND status <> 'VOID' AND has_vat_receipt AND source <> 'PURCHASE' AND issue_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        wht = _f(db.scalar("SELECT coalesce(sum(bp.withheld), 0) FROM bill_payment bp JOIN bill bl ON bl.id = bp.bill_id WHERE bl.org_id = ? AND bp.paid_on BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        pr = db.one("""SELECT coalesce(sum(total_income_tax), 0) AS tax, coalesce(sum(total_pension_employee), 0) AS pe, coalesce(sum(total_pension_employer), 0) AS pr
                       FROM payroll_run WHERE org_id = ? AND period_month = ? AND status IN ('APPROVED','PAID')""", (org, a.isoformat())) or {}
        vin = in_pur + in_exp + in_bill
        rows = [
            ["Net sales (excl. VAT)", round(sales_net, 2), ""],
            ["Output VAT (15% collected on sales)", round(out_vat, 2), "From paid orders"],
            ["Input VAT on purchases", round(in_pur, 2), "Only purchases marked with a VAT receipt"],
            ["Input VAT on expenses", round(in_exp, 2), "Only expenses marked with a VAT receipt"],
            ["Input VAT on supplier bills", round(in_bill, 2), ""],
            ["VAT payable (output − input)", round(out_vat - vin, 2), "Negative = credit to carry forward"],
            ["Withholding tax deducted from suppliers", round(wht, 2), "Pay over to the Ministry of Revenue"],
            ["Employee income tax (PAYE)", round(_f(pr.get("tax")), 2), "From the approved payroll" if pr.get("tax") else "No approved payroll for this month"],
            ["Pension – employee 7%", round(_f(pr.get("pe")), 2), ""],
            ["Pension – employer 11%", round(_f(pr.get("pr")), 2), ""],
        ]
        title = f"Monthly tax summary {ym}"

    elif key == "inventory":
        cols = ["Branch", "Item", "Group", "On hand", "Unit", "Unit cost", "Stock value", "Reorder at", "Status"]
        names = {r["key"]: r["text"] for r in db.all("SELECT key, text FROM i18n_text WHERE lang = 'en' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,))}
        total = 0.0
        for r in db.all("""SELECT br.name AS branch, i.custom_name, i.name_key, i.main_category_code, i.unit_code, i.standard_unit_cost,
                                  st.on_hand, st.reorder_point, st.last_unit_cost, st.avg_unit_cost
                           FROM branch_stock st JOIN inventory_item i ON i.id = st.item_id JOIN branch br ON br.id = st.branch_id
                           WHERE st.org_id = ? AND i.deleted_at IS NULL ORDER BY br.name, i.main_category_code, i.id""", (org,)):
            on = _f(r["on_hand"])
            cost = _f(r["avg_unit_cost"]) or _f(r["last_unit_cost"]) or _f(r["standard_unit_cost"])
            value = on * cost
            total += value
            reorder = _f(r["reorder_point"])
            status = "Out of stock" if on <= 0 else "Low" if reorder and on <= reorder else "OK"
            rows.append([r["branch"], r["custom_name"] or names.get(r["name_key"], r["name_key"]), names.get(f"main.{r['main_category_code']}", r["main_category_code"]),
                         round(on, 3), r["unit_code"], round(cost, 2), round(value, 2), round(reorder, 3), status])
        rows.append(["Total", "", "", "", "", "", round(total, 2), "", ""])
        title = f"Inventory valuation {today.isoformat()}"

    elif key == "staff":
        cols = ["Name", "Role", "Days worked", "Hours worked", "Late minutes", "Overtime hours", "Gross pay", "Employer pension", "Labor cost"]
        roles = {r["key"]: r["text"] for r in db.all("SELECT key, text FROM i18n_text WHERE lang = 'en' AND key LIKE 'role.%' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,))}
        att: dict[str, list] = {}
        for r in db.all("""SELECT employee_id, clock_in, clock_out, late_minutes, overtime_hours FROM attendance_record
                           WHERE org_id = ? AND work_date BETWEEN ? AND ? AND clock_in IS NOT NULL""", (org, a.isoformat(), b.isoformat())):
            x = att.setdefault(r["employee_id"], [0, 0.0, 0, 0.0])
            x[0] += 1
            x[1] += _hours(r["clock_in"], r["clock_out"])
            x[2] += int(r["late_minutes"] or 0)
            x[3] += _f(r["overtime_hours"])
        slips = {r["employee_id"]: r for r in db.all("""SELECT ps.employee_id, sum(ps.gross_taxable) AS gross, sum(ps.pension_employer) AS pr FROM payslip ps
                                                        JOIN payroll_run pr ON pr.id = ps.payroll_run_id
                                                        WHERE pr.org_id = ? AND pr.period_month = ? GROUP BY ps.employee_id""", (org, a.isoformat()))}
        total = 0.0
        for e in db.all("""SELECT e.user_id, u.full_name, u.role_code, e.pay_type, e.hourly_rate, e.monthly_salary FROM employee e JOIN app_user u ON u.id = e.user_id
                           WHERE e.org_id = ? AND (e.termination_date IS NULL OR e.termination_date >= ?) ORDER BY u.full_name""", (org, a.isoformat())):
            d_, h_, late, ot = att.get(e["user_id"], [0, 0.0, 0, 0.0])
            slip = slips.get(e["user_id"])
            if slip:
                gross, pens = _f(slip["gross"]), _f(slip["pr"])
            else:   # no payroll run yet: estimate from the contract
                gross = _f(e["monthly_salary"]) if e["pay_type"] != "HOURLY" else _f(e["hourly_rate"]) * h_
                pens = gross * 0.11
            total += gross + pens
            rows.append([e["full_name"], roles.get(f"role.{e['role_code']}", e["role_code"]), d_, round(h_, 1), late, round(ot, 1),
                         round(gross, 2), round(pens, 2), round(gross + pens, 2)])
        net = _f(db.scalar("SELECT coalesce(sum(total_gross - vat_amount), 0) FROM customer_order WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ?", (org, a.isoformat(), b.isoformat())))
        rows.append(["Total", "", "", "", "", "", "", "", round(total, 2)])
        rows.append(["Labor cost % of net sales", "", "", "", "", "", "", "", round(total / net * 100, 1) if net else 0])
        title = f"Staff hours & cost {ym}"

    else:  # menu
        cols = ["Dish", "Units sold", "Revenue (incl. VAT)", "Share of sales %", "Average price"]
        names = {r["key"]: r["text"] for r in db.all("SELECT key, text FROM i18n_text WHERE lang = 'en' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,))}
        dishes = db.all("""SELECT m.name_key, sum(l.quantity) AS sold, sum(l.total) AS revenue FROM v_sale_line l JOIN menu_item m ON m.id = l.menu_item_id
                           WHERE l.org_id = ? AND l.business_date BETWEEN ? AND ? GROUP BY m.name_key ORDER BY revenue DESC""", (org, a.isoformat(), b.isoformat()))
        total = sum(_f(d["revenue"]) for d in dishes) or 1
        for d in dishes:
            sold, rev_ = _f(d["sold"]), _f(d["revenue"])
            rows.append([names.get(d["name_key"], d["name_key"]), int(sold), round(rev_, 2), round(rev_ / total * 100, 1), round(rev_ / sold, 2) if sold else 0])
        title = f"Menu performance {ym}"

    return {"key": key, "title": title, "filename": f"seer-{key}-{ym if key not in ('inventory', 'weekly-pnl') else today.isoformat()}.csv",
            "columns": cols, "rows": rows}
