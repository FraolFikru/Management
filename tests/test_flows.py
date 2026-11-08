#!/usr/bin/env python3
"""End-to-end checks of the cross-module flows on a fresh database.

    python3 -I tests/test_flows.py                                   # SQLite, no dependencies
    EIRSHA_TEST_PG=postgresql:///scratch python3 tests/test_flows.py  # PostgreSQL (needs psycopg; drops schema eirsha!)

Loads db/sqlite/001_schema.sql + 002_views.sql + db/seed/sqlite/010_reference.sql
(the real people, menu, vendors, tax rules) and drives the services the API uses.
"""
from __future__ import annotations

import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

from eirsha_api import services as s  # noqa: E402
from eirsha_api.db import D, Db  # noqa: E402

BOLE, PIA = "BR-BOLE", "BR-PIA"


def fresh_db() -> Db:
    """SQLite in memory by default; EIRSHA_TEST_PG=<dsn> runs the same tests on a scratch PostgreSQL schema."""
    dsn = os.environ.get("EIRSHA_TEST_PG")
    if dsn:
        db = Db.postgres(dsn)
        db.conn.execute("DROP SCHEMA IF EXISTS eirsha CASCADE")
        for f in ("db/postgres/001_schema.sql", "db/postgres/002_views.sql", "db/seed/postgres/010_reference.sql"):
            db.conn.execute(open(os.path.join(ROOT, f), encoding="utf-8").read())
        db.conn.execute("SET search_path = eirsha, public")
        return db
    db = Db.sqlite(":memory:")
    for f in ("db/sqlite/001_schema.sql", "db/sqlite/002_views.sql", "db/seed/sqlite/010_reference.sql"):
        db.conn.executescript(open(os.path.join(ROOT, f), encoding="utf-8").read())
    return db


def who(db: Db, name: str, branch: str | None = BOLE) -> s.Actor:
    uid = db.scalar("SELECT id FROM app_user WHERE full_name = ?", (name,))
    return s.Actor.load(db, uid, branch)


def events(db: Db, topic: str) -> list[dict]:
    return [dict(r, payload=db.json(r["payload"])) for r in db.all("SELECT * FROM outbox_event WHERE topic = ? ORDER BY id", (topic,))]


# ---------------------------------------------------------------- tests

def test_pos_to_kds_to_zreport(db: Db) -> None:
    meron = who(db, "Meron Girma")            # sales staff (HR EMP-004 = Manager SS-104)
    kitchen = who(db, "Tigist Mengistu")      # kitchen staff
    hanna = who(db, "Hanna Tesfaye")          # branch manager
    o = s.create_order(db, meron, BOLE, "DINE_IN", [
        {"menu_item_id": "doro-wat", "quantity": 1, "modifiers": [{"modifier_id": "no-onion"}]},
        {"menu_item_id": "macchiato", "quantity": 2},
    ], table_number="7")
    # Bole has branch prices: doro-wat 720, macchiato 70 (Admin overrides)
    assert D(o["total_gross"]) == Decimal("860.00"), o["total_gross"]
    assert D(o["vat_amount"]) == Decimal("112.17"), o["vat_amount"]      # 860 × 15/115

    t = s.send_to_kitchen(db, meron, o["id"])
    assert t["status"] == "PENDING" and len(t["items"]) == 2
    assert {i["station"] for i in t["items"]} == {"HOT_KITCHEN", "BAR"}
    assert t["items"][0]["modifiers"][0]["id"] == "no-onion"
    ev = events(db, "kds.ticket")
    assert ev[-1]["payload"]["type"] == "upsert" and ev[-1]["branch_id"] == BOLE

    # the KDS validator's required fields are all present
    for k in ("id", "orderNumber", "orderType", "items", "status", "createdAt", "submittedBy", "branchId"):
        assert t[k], k

    s.kds_command(db, kitchen, t["id"], "item", {"itemId": t["items"][0]["id"], "isCompleted": True})
    s.kds_command(db, kitchen, t["id"], "status", {"status": "PREPARING"})
    p = s.kds_command(db, kitchen, t["id"], "status", {"status": "READY"})["ticket"]
    assert p["readyAt"] and all(i["isCompleted"] for i in p["items"])
    try:
        s.kds_command(db, kitchen, t["id"], "status", {"status": "READY", "expectedVersion": 1})
        raise AssertionError("stale version accepted")
    except s.Conflict:
        pass
    assert s.kds_command(db, kitchen, t["id"], "bump", {})["type"] == "remove"
    assert s.kds_snapshot(db, BOLE)["tickets"] == []
    back = s.kds_command(db, kitchen, t["id"], "recall", {})["ticket"]
    assert back["status"] == "READY", back["status"]                       # recall restores the pre-bump status
    s.kds_command(db, kitchen, t["id"], "bump", {})

    # add a second course → second ticket, numbered "-2"
    s.add_lines(db, meron, o["id"], [{"menu_item_id": "beef-tibs", "quantity": 1}])
    t2 = s.send_to_kitchen(db, meron, o["id"])
    assert t2["orderNumber"].endswith("-2") and len(t2["items"]) == 1
    tibs = db.scalar("SELECT id FROM order_line WHERE order_id = ? AND menu_item_id = 'beef-tibs'", (o["id"],))
    s.void_line(db, hanna, tibs, "Customer changed mind")
    assert db.scalar("SELECT count(*) FROM performance_log WHERE log_type = 'VOID_INCIDENT' AND employee_id = ?", (meron.user_id,)) == 1
    assert s.kds_payload(db, t2["id"])["items"] == []                      # voided line leaves the KDS ticket

    # pay with split tender; Telebirr needs a reference
    try:
        s.pay_order(db, meron, o["id"], [{"method": "TELEBIRR", "amount": 500}])
        raise AssertionError("telebirr without reference accepted")
    except s.Invalid:
        pass
    paid = s.pay_order(db, meron, o["id"], [{"method": "TELEBIRR", "amount": 500, "reference": "TB123456"},
                                            {"method": "CASH", "amount": 360, "tendered": 400}])
    assert paid["status"] == "PAID" and paid["receipt_no"].startswith("BOL")
    sale = db.all("SELECT * FROM v_sale_line WHERE ticket_no = ?", (o["order_number"],))
    assert len(sale) == 2                                                   # Manager sales overview sees both active lines

    day = o["business_date"]
    z = s.close_day(db, hanna, BOLE, day)
    assert Decimal(z["gross"]) == Decimal("860.00") and Decimal(z["byMethod"]["TELEBIRR"]) == Decimal("500.00")
    assert Decimal(z["food"]) + Decimal(z["beverage"]) == Decimal(z["gross"]) - Decimal(z["vat"])
    rec = db.one("SELECT * FROM cash_reconciliation WHERE branch_id = ? AND business_date = ?", (BOLE, day))
    assert D(rec["cash_expected"]) == Decimal("360.00")
    pnl = db.all("SELECT * FROM v_pnl_monthly WHERE section = 'REVENUE'")
    assert D(pnl[0]["amount"]) == Decimal("747.83")                         # Finance P&L picks up the net revenue
    bal = db.one("SELECT balance FROM v_account_balance WHERE money_account_id = 'ACC-BOL-DRAWER'")
    assert D(bal["balance"]) == Decimal("360.00")
    try:
        s.close_day(db, hanna, BOLE, day)
        raise AssertionError("closed twice")
    except s.Conflict:
        pass


def test_purchase_review_bill_withholding(db: Db) -> None:
    dawit = who(db, "Dawit Alemu")             # inventory clerk (Sales u-dawit = Manager IC-201 = HR EMP-003)
    hanna = who(db, "Hanna Tesfaye")
    mahlet = who(db, "Mahlet Assefa", None)    # accountant (Finance EMP-020)
    before = D(db.scalar("SELECT coalesce(sum(on_hand),0) FROM branch_stock WHERE branch_id = ? AND item_id = 'beef'", (BOLE,)))

    # 1) paid on the spot, small: no withholding, bill created already settled
    p1 = s.log_purchase(db, dawit, BOLE, "beef", 10, 650, vendor_name="Merkato Fresh Produce", payment_method="CASH")
    assert p1["review_status"] == "PENDING"
    q = db.all("SELECT * FROM v_manager_queue WHERE entity_type = 'purchase'")
    assert [r["entity_id"] for r in q] == [p1["id"]]                       # shows up in Manager review
    r1 = s.review_purchase(db, hanna, p1["id"], "APPROVE")
    assert r1["status"] == "APPROVED" and not r1["warnings"]
    after = D(db.scalar("SELECT on_hand FROM branch_stock WHERE branch_id = ? AND item_id = 'beef'", (BOLE,)))
    assert after - before == 10
    b1 = db.one("SELECT * FROM v_bill_status WHERE id = ?", (r1["billId"],))
    assert b1["display_status"] == "PAID" and D(b1["total"]) == Decimal("6500.00")
    assert db.scalar("SELECT purchase_id FROM bill_line WHERE bill_id = ?", (r1["billId"],)) == p1["id"]

    # 2) on credit, above the 20 000 goods threshold, vendor HAS a TIN → 3 %
    p2 = s.log_purchase(db, dawit, BOLE, "teff", 400, 95, vendor_id="V-04", settlement="ON_CREDIT", payment_method=None)
    r2 = s.review_purchase(db, hanna, p2["id"], "APPROVE")
    b2 = db.one("SELECT * FROM v_bill_status WHERE id = ?", (r2["billId"],))
    assert b2["display_status"] in ("OPEN", "DUE_SOON") and D(b2["balance_due"]) == Decimal("38000.00"), b2
    pay = s.pay_bill(db, mahlet, r2["billId"], 38000, "CBE_BIRR", reference="FT2611080001")
    assert Decimal(pay["withheld"]) == Decimal("1140.00") and Decimal(pay["netPaid"]) == Decimal("36860.00"), pay
    assert db.one("SELECT display_status FROM v_bill_status WHERE id = ?", (r2["billId"],))["display_status"] == "PAID"
    assert D(db.scalar("SELECT withheld FROM v_wht_monthly")) == Decimal("1140.00")

    # 3) vendor typed for the first time (no TIN) → created; big credit purchase → 30 %
    p3 = s.log_purchase(db, dawit, BOLE, "beef", 50, 640, vendor_name="Akaki Butchery", settlement="ON_CREDIT", payment_method=None)
    assert db.scalar("SELECT tin_number FROM vendor WHERE id = ?", (p3["vendor_id"],)) is None
    r3 = s.review_purchase(db, hanna, p3["id"], "APPROVE")
    pay3 = s.pay_bill(db, mahlet, r3["billId"], 10000, "CASH")
    assert Decimal(pay3["withholdingRate"]) == Decimal("0.3") and Decimal(pay3["withheld"]) == Decimal("3000.00"), pay3
    assert db.one("SELECT display_status FROM v_bill_status WHERE id = ?", (r3["billId"],))["display_status"] != "PAID"

    # 4) flag needs a reason; a flagged purchase can be re-reviewed
    p4 = s.log_purchase(db, dawit, BOLE, "onion", 5, 45, vendor_name="Merkato Fresh Produce")
    try:
        s.review_purchase(db, hanna, p4["id"], "FLAG")
        raise AssertionError("flag without reason accepted")
    except s.Invalid:
        pass
    s.review_purchase(db, hanna, p4["id"], "FLAG", "Receipt missing")
    s.review_purchase(db, hanna, p4["id"], "APPROVE")
    # avg cost moved: 10 @650 then 50 @640 → (10·650 + 50·640)/60
    avg = D(db.scalar("SELECT avg_unit_cost FROM branch_stock WHERE branch_id = ? AND item_id = 'beef'", (BOLE,)))
    assert avg.quantize(Decimal("0.01")) == Decimal("641.67"), avg

    # P&L: approved purchases appear as COGS through their bills (no double count)
    cogs = D(db.scalar("SELECT sum(amount) FROM v_pnl_monthly WHERE section = 'COGS'"))
    assert cogs == Decimal("6500") + Decimal("38000") + Decimal("32000") + Decimal("225"), cogs
    acts = {r["action"] for r in db.all("SELECT action FROM audit_log")}
    assert {"purchase.create", "purchase.approve", "purchase.flag", "bill.pay"} <= acts


def test_waste_dispatch_expense(db: Db) -> None:
    dawit, hanna, meron = who(db, "Dawit Alemu"), who(db, "Hanna Tesfaye"), who(db, "Meron Girma")
    s.log_purchase(db, dawit, BOLE, "tomato", 20, 40, vendor_name="Merkato Fresh Produce")
    s.review_purchase(db, hanna, db.scalar("SELECT id FROM purchase WHERE item_id='tomato'"), "APPROVE")
    db.update("branch_stock", {"branch_id": BOLE, "item_id": "tomato"}, {"reorder_point": 12})
    try:
        s.log_waste(db, dawit, BOLE, "tomato", 1, "INVENTORY_THEFT")
        raise AssertionError("theft without note accepted")
    except s.Invalid:
        pass
    w = s.log_waste(db, dawit, BOLE, "tomato", 2.5, "SPOILAGE")
    assert D(w["loss_value"]) == Decimal("100.00")
    s.decide_waste(db, hanna, w["id"], True)
    d = s.request_dispatch(db, meron, BOLE, "tomato", 6, to_location="KITCHEN_LINE")
    s.decide_dispatch(db, hanna, d["id"], True)
    on_hand = D(db.scalar("SELECT on_hand FROM branch_stock WHERE branch_id = ? AND item_id = 'tomato'", (BOLE,)))
    assert on_hand == Decimal("11.5"), on_hand
    assert db.one("SELECT is_low_stock FROM v_branch_stock_status WHERE branch_id = ? AND item_id = 'tomato'", (BOLE,))["is_low_stock"]
    assert events(db, "stock.low"), "low-stock alert not emitted"
    big = s.request_dispatch(db, meron, BOLE, "tomato", 50, to_branch_id=PIA)
    try:
        s.decide_dispatch(db, hanna, big["id"], True)
        raise AssertionError("over-dispatch accepted")
    except s.Conflict:
        pass
    t = s.request_dispatch(db, meron, BOLE, "tomato", 3, to_branch_id=PIA)
    s.decide_dispatch(db, hanna, t["id"], True)
    s.receive_transfer(db, who(db, "Meron Haile", PIA), t["id"])
    assert D(db.scalar("SELECT on_hand FROM branch_stock WHERE branch_id = ? AND item_id = 'tomato'", (PIA,))) == 3
    e = s.log_expense(db, dawit, BOLE, "Bajaj to Merkato", "TRANSPORT", 250, "CASH", petty_cash=True)
    assert e["review_status"] == "PENDING"
    assert D(db.scalar("SELECT balance FROM v_account_balance WHERE money_account_id = 'ACC-BOL-PETTY'")) == Decimal("-250.00")
    waste_pnl = D(db.scalar("SELECT sum(amount) FROM v_pnl_monthly WHERE section = 'WASTE'"))
    assert waste_pnl == Decimal("100.00")


def test_hr_attendance_payroll_finance(db: Db) -> None:
    hanna = who(db, "Hanna Tesfaye")
    meron = who(db, "Meron Girma")
    abebe = who(db, "Abebe Kebede")
    # a Monday two weeks ago, scheduled EVENING 14:00–22:00 Addis
    d0 = date.today() - timedelta(days=date.today().weekday() + 14)
    db.insert("schedule_entry", {"id": "sch-1", "org_id": "STORE-01", "branch_id": BOLE, "employee_id": meron.user_id,
                                 "work_date": d0.isoformat(), "shift_code": "EVENING", "status": "PUBLISHED"})
    at_in = datetime(d0.year, d0.month, d0.day, 14, 12, tzinfo=s.ADDIS)        # 12 min late
    at_out = datetime(d0.year, d0.month, d0.day, 23, 0, tzinfo=s.ADDIS)        # 1 h overtime, after 22:00
    a = s.clock_in(db, meron, meron.user_id, at_in.isoformat())
    assert a["late_minutes"] == 12 and a["schedule_entry_id"] == "sch-1"
    assert db.scalar("SELECT count(*) FROM performance_log WHERE log_type = 'LATENESS'") == 1
    a = s.clock_out(db, hanna, meron.user_id, at_out.isoformat())
    assert D(a["overtime_hours"]) == Decimal("0.80") and D(a["overtime_multiplier"]) == Decimal("1.75"), a   # 8.8 h worked
    month = d0.isoformat()[:7]
    run = s.calculate_payroll(db, hanna, month, BOLE, today=f"{month}-28")
    slip = db.one("SELECT * FROM payslip WHERE payroll_run_id = ? AND employee_id = ?", (run["id"], meron.user_id))
    # Meron: HOURLY 42 ETB → base 8 h × 42 = 336; OT 0.8 × 42 × 1.75 = 58.80
    assert D(slip["base_pay"]) == Decimal("336.00") and D(slip["overtime_pay"]) == Decimal("58.80"), slip
    hanna_slip = db.one("SELECT * FROM payslip WHERE payroll_run_id = ? AND employee_id = ?", (run["id"], hanna.user_id))
    assert D(hanna_slip["pension_employee"]) == (D(hanna_slip["base_pay"]) * Decimal("0.07")).quantize(Decimal("0.01"))
    s.approve_payroll(db, hanna, run["id"])
    assert events(db, "fin.payroll")[-1]["payload"]["month"] == month
    paid = s.pay_payroll(db, abebe, run["id"], "ACC-BANK")
    assert paid["status"] == "PAID"
    paye = db.one("SELECT * FROM tax_filing WHERE kind = 'PAYE'")
    assert D(paye["amount_due"]) == D(run["total_income_tax"])
    opex = D(db.scalar("SELECT amount FROM v_pnl_monthly WHERE category = 'PAYROLL'"))
    assert opex == D(run["total_gross"]) + D(run["total_pension_employer"])


def test_permissions_and_identity(db: Db) -> None:
    perms = lambda name: {r["permission_code"] for r in db.all(
        "SELECT permission_code FROM v_user_permission v JOIN app_user u ON u.id = v.user_id WHERE u.full_name = ?", (name,))}
    assert "purchase.review" in perms("Hanna Tesfaye") and "admin.access" not in perms("Hanna Tesfaye")
    assert "kds.update" in perms("Tigist Mengistu") and "pos.sell" not in perms("Tigist Mengistu")
    assert "pos.sell" in perms("Meron Girma") and "purchase.review" not in perms("Meron Girma")
    assert "fin.bill_pay" in perms("Mahlet Assefa")
    one = lambda m, e, l: db.scalar("SELECT canonical_id FROM legacy_id_map WHERE module = ? AND entity_type = ? AND legacy_id = ?", (m, e, l))
    hanna = db.scalar("SELECT id FROM app_user WHERE full_name = 'Hanna Tesfaye'")
    assert one("SALES", "user", "u-hanna") == one("MGR", "user", "BM-001") == one("HR", "user", "EMP-001") == hanna
    assert one("ADMIN", "menu_item", "DORO_WAT") == "doro-wat" and one("HR", "branch", "BR-PIASSA-02") == "BR-PIA"
    s.audit(db, s.Actor.load(db, hanna), "SYSTEM", "test.write", "test", None, "probe")
    try:
        if db.dialect == "postgres":
            with db.conn.transaction():          # savepoint, so the failed UPDATE doesn't poison the test transaction
                db.execute("UPDATE audit_log SET action = 'x'")
        else:
            db.execute("UPDATE audit_log SET action = 'x'")
        raise AssertionError("audit_log was updatable")
    except AssertionError:
        raise
    except Exception as e:  # noqa: BLE001
        assert "append-only" in str(e)


TESTS = [test_pos_to_kds_to_zreport, test_purchase_review_bill_withholding, test_waste_dispatch_expense,
         test_hr_attendance_payroll_finance, test_permissions_and_identity]

if __name__ == "__main__":
    failed = 0
    for t in TESTS:
        db = fresh_db()
        try:
            with db.tx():
                t(db)
            print(f"PASS {t.__name__}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"{len(TESTS) - failed}/{len(TESTS)} passed")
    sys.exit(1 if failed else 0)
