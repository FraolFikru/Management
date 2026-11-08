"""Owner dashboard (ffii-main / "Restaurant Owner OS"): read-only roll-ups + budgets."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from .. import services as s
from ..db import new_id
from . import Db, Depends, Principal, get_db, require

router = APIRouter(prefix="/owner", tags=["owner"])


class BudgetIn(BaseModel):
    category: str            # cost_category code
    allocated: float
    fixedCommitment: float | None = None


@router.get("/cash-flow")
def cash_flow(year: int, p: Principal = Depends(require("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main MonthPoint[]: {month, revenue, expenses} from the P&L view."""
    rows = db.all("""SELECT month, sum(CASE WHEN section = 'REVENUE' THEN amount ELSE 0 END) AS revenue,
                            sum(CASE WHEN section <> 'REVENUE' THEN amount ELSE 0 END) AS expenses
                     FROM v_pnl_monthly WHERE org_id = ? AND month >= ? AND month <= ? GROUP BY month ORDER BY month""",
                  (p.actor.org_id, f"{year}-01-01", f"{year}-12-01"))
    return [{"month": str(r["month"])[:7], "revenue": r["revenue"], "expenses": r["expenses"]} for r in rows]


@router.get("/balances")
def balances(p: Principal = Depends(require("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main paymentMethods cards: Telebirr / Cash / CBE balances."""
    return db.all("SELECT kind, name, sum(balance) AS balance FROM v_account_balance WHERE org_id = ? GROUP BY kind, name", (p.actor.org_id,))


@router.get("/top-dishes")
def top_dishes(frm: str, to: str, p: Principal = Depends(require("owner.dashboard")), db: Db = Depends(get_db)):
    return db.all("""SELECT menu_item_id, sum(quantity) AS sold, sum(total) AS revenue FROM v_sale_line
                     WHERE org_id = ? AND business_date BETWEEN ? AND ? GROUP BY menu_item_id ORDER BY revenue DESC LIMIT 10""",
                  (p.actor.org_id, frm, to))


@router.get("/peak-hours")
def peak_hours(frm: str, to: str, p: Principal = Depends(require("owner.dashboard")), db: Db = Depends(get_db)):
    hour = "CAST(strftime('%H', datetime(created_at, '+3 hours')) AS integer)" if db.dialect == "sqlite" \
        else "extract(hour from created_at AT TIME ZONE 'Africa/Addis_Ababa')::int"
    return db.all(f"""SELECT {hour} AS hour, count(*) AS orders FROM customer_order
                      WHERE org_id = ? AND status = 'PAID' AND business_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1""",
                  (p.actor.org_id, frm, to))


@router.get("/budgets/{month}")
def budgets(month: str, p: Principal = Depends(require("owner.dashboard")), db: Db = Depends(get_db)):
    """ffii-main BudgetLine[]: allocated vs actual (from the P&L) vs last month."""
    first = f"{month}-01"
    rows = db.all("""SELECT b.cost_category_code AS category, b.allocated, b.fixed_commitment,
                            (SELECT coalesce(sum(amount),0) FROM v_pnl_monthly v WHERE v.org_id = b.org_id AND v.month = b.period_month AND v.category = b.cost_category_code) AS spent
                     FROM budget_line b WHERE b.org_id = ? AND b.period_month = ? AND b.branch_id IS NULL""", (p.actor.org_id, first))
    return rows


@router.put("/budgets/{month}")
def save_budget(month: str, body: BudgetIn, p: Principal = Depends(require("owner.budget_edit")), db: Db = Depends(get_db)):
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
