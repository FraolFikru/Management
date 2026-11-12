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
    month_cost = lambda m: sum(costs.get(m, {}).values())
    month_rev = lambda m: sum(v for d, v in rev.items() if d.startswith(m))

    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    cash_flow = [{"month": names[i], "revenue": round(month_rev(f"{today.year}-{i + 1:02d}")), "expenses": round(month_cost(f"{today.year}-{i + 1:02d}"))}
                 for i in range(12)]

    daily_cost: dict[str, float] = {}
    for sql in ("SELECT business_date AS d, sum(total_cost - vat_amount) AS a FROM purchase WHERE org_id = ? AND review_status = 'APPROVED' AND deleted_at IS NULL AND business_date >= ? GROUP BY business_date",
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

    # --- transactions: bills, on-the-spot expenses and payroll, newest first
    tx = []
    for b in db.all("""SELECT * FROM v_bill_status WHERE org_id = ? AND display_status NOT IN ('VOID','DRAFT') AND issue_date >= ?
                       ORDER BY issue_date DESC LIMIT 120""", (org, (today - timedelta(days=90)).isoformat())):
        st = {"PAID": "Success", "OVERDUE": "Failed"}.get(b["display_status"], "Pending")
        tx.append({"id": b["bill_no"] or b["id"], "description": f"{b['vendor_name']}" + (f" · {b['description']}" if b["description"] and len(b["description"]) < 40 else ""),
                   "category": GROUP_OF.get(b["cost_category_code"], "Supplies"), "date": str(b["issue_date"])[:10],
                   "amount": -round(_f(b["total"]), 2), "status": st})
    for e in db.all("SELECT * FROM expense WHERE org_id = ? AND deleted_at IS NULL AND business_date >= ? ORDER BY business_date DESC LIMIT 60",
                    (org, (today - timedelta(days=90)).isoformat())):
        tx.append({"id": e["id"], "description": e["reason"], "category": GROUP_OF.get(e["cost_category_code"], "Supplies"),
                   "date": str(e["business_date"])[:10], "amount": -round(_f(e["amount"]), 2), "status": "Success"})
    for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status IN ('APPROVED','PAID') ORDER BY period_month DESC LIMIT 6", (org,)):
        m = str(r["period_month"])[:7]
        tx.append({"id": f"PAY-{m}", "description": f"Staff payroll {m}", "category": "Labor", "date": str(r["paid_on"] or r["approved_at"] or r["period_month"])[:10],
                   "amount": -round(_f(r["total_gross"]) + _f(r["total_pension_employer"]), 2), "status": "Success" if r["status"] == "PAID" else "Pending"})
    tx.sort(key=lambda x: x["date"], reverse=True)

    # --- analytics: this month (or the last 30 days when the month has just started)
    frm = this_m if today.day >= 7 else today - timedelta(days=30)
    names_en = {r["key"]: r["text"] for r in db.all("SELECT key, text FROM i18n_text WHERE lang = 'en' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,))}
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
    goals = [
        {"title": "Monthly Revenue Target", "current": round(cur_rev), "target": round(max(last_rev * 1.1, 1) / 1000) * 1000 or 1000, "unit": "ETB", "deadline": month_end},
        {"title": "Food Cost under 30%", "current": round(food / cur_rev * 100, 1) if cur_rev else 0, "target": 30, "unit": "%", "deadline": month_end, "lowerIsBetter": True},
        {"title": "Average Order Value", "current": round(_f(gross_m) / n_orders) if n_orders else 0,
         "target": 480, "unit": "ETB", "deadline": month_end},
    ]
    return {"role": p.actor.role if p.actor.role in OWNER_ROLES else None,
            "user": {"name": me.get("full_name", ""), "email": me.get("email") or "", "restaurant": org_row.get("trade_name") or org_row.get("legal_name") or ""},
            "cashFlow": cash_flow, "daily": daily, "weekly": weekly, "monthToDate": month_to_date, "paymentMethods": payment_methods, "transactions": tx[:80],
            "topDishes": top, "peakHours": peak, "budgets": budgets, "goals": goals}


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
