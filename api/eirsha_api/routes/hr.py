"""HR & Staff (HR-main): employees, schedule, attendance, payroll, performance."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .. import services as s
from ..auth import hash_secret
from ..db import new_id, now_iso
from . import Db, Depends, Principal, branch_of, get_db, require

router = APIRouter(prefix="/hr", tags=["hr"])


class EmployeeIn(BaseModel):
    fullName: str
    role: str
    phone: str | None = None
    email: str | None = None
    branchId: str
    hireDate: str
    payType: Literal["HOURLY", "MONTHLY"]
    hourlyRate: float = 0
    monthlySalary: float | None = None
    pin: str | None = None


class ScheduleIn(BaseModel):
    employeeId: str
    date: str
    shift: Literal["MORNING", "DAY", "EVENING"]


class ClockIn(BaseModel):
    employeeId: str
    at: str | None = None


class LogIn(BaseModel):
    employeeId: str
    type: Literal["REVIEW", "COMMENDATION", "VOID_INCIDENT", "LATENESS", "WARNING", "INCIDENT"]
    rating: int | None = None
    severity: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"
    note: str
    reference: str | None = None


@router.get("/employees")
def employees(p: Principal = Depends(require("hr.view")), db: Db = Depends(get_db)):
    """HR-main EmployeeProfile[] — the same people as Admin's user accounts."""
    return db.all("""SELECT e.*, u.full_name, u.role_code, u.phone, u.email, u.home_branch_id, u.staff_code, u.is_active
                     FROM employee e JOIN app_user u ON u.id = e.user_id WHERE e.org_id = ? ORDER BY e.employee_no""", (p.actor.org_id,))


@router.post("/employees", status_code=201)
def hire(body: EmployeeIn, p: Principal = Depends(require("hr.staff_manage")), db: Db = Depends(get_db)):
    """Hiring creates the login account too (no password yet; PIN for terminals)."""
    with db.tx():
        uid = new_id("usr")
        n = int(db.scalar("SELECT count(*) FROM employee WHERE org_id = ?", (p.actor.org_id,))) + 1
        db.insert("app_user", {"id": uid, "org_id": p.actor.org_id, "full_name": body.fullName, "role_code": body.role, "phone": body.phone,
                               "email": body.email, "home_branch_id": body.branchId, "initials": "".join(w[0] for w in body.fullName.split()[:2]).upper(),
                               "pin_hash": hash_secret(body.pin) if body.pin else None})
        db.insert("employee", {"user_id": uid, "org_id": p.actor.org_id, "employee_no": f"EMP-{n:03d}", "hire_date": body.hireDate,
                               "pay_type": body.payType, "hourly_rate": body.hourlyRate, "monthly_salary": body.monthlySalary})
        s.audit(db, p.actor, "HR", "employee.hire", "employee", uid, "Hired {name} as {role}", {"name": body.fullName, "role": body.role})
        return db.one("SELECT * FROM employee WHERE user_id = ?", (uid,))


@router.get("/schedule")
def schedule(week_start: str, p: Principal = Depends(require("hr.view", "hr.schedule_manage")), db: Db = Depends(get_db)):
    return db.all("""SELECT * FROM schedule_entry WHERE branch_id = ? AND work_date >= ? AND work_date < date(?, '+7 days')
                     AND status <> 'CANCELLED'""" if db.dialect == "sqlite" else
                  """SELECT * FROM schedule_entry WHERE branch_id = ? AND work_date >= ? AND work_date < CAST(? AS date) + 7
                     AND status <> 'CANCELLED'""", (branch_of(p), week_start, week_start))


@router.post("/schedule", status_code=201)
def plan(body: ScheduleIn, p: Principal = Depends(require("hr.schedule_manage")), db: Db = Depends(get_db)):
    with db.tx():
        sid = new_id("sch")
        db.insert("schedule_entry", {"id": sid, "org_id": p.actor.org_id, "branch_id": branch_of(p), "employee_id": body.employeeId,
                                     "work_date": body.date, "shift_code": body.shift, "status": "PUBLISHED", "created_by": p.actor.user_id})
        s.audit(db, p.actor, "HR", "schedule_entry.create", "schedule_entry", sid, "Scheduled {shift} on {date}", {"shift": body.shift, "date": body.date})
        return db.one("SELECT * FROM schedule_entry WHERE id = ?", (sid,))


@router.post("/attendance/clock-in")
def clock_in(body: ClockIn, p: Principal = Depends(require("hr.attendance_self", "hr.attendance_manage")), db: Db = Depends(get_db)):
    if body.employeeId != p.actor.user_id and "hr.attendance_manage" not in p.permissions:
        raise s.ServiceError("you can only clock yourself in")
    with db.tx():
        return s.clock_in(db, p.actor, body.employeeId, body.at, p.actor.device_id)


@router.post("/attendance/clock-out")
def clock_out(body: ClockIn, p: Principal = Depends(require("hr.attendance_self", "hr.attendance_manage")), db: Db = Depends(get_db)):
    if body.employeeId != p.actor.user_id and "hr.attendance_manage" not in p.permissions:
        raise s.ServiceError("you can only clock yourself out")
    with db.tx():
        return s.clock_out(db, p.actor, body.employeeId, body.at)


@router.post("/attendance/{aid}/breaks")
def break_toggle(aid: str, p: Principal = Depends(require("hr.attendance_self", "hr.attendance_manage")), db: Db = Depends(get_db)):
    with db.tx():
        open_b = db.one("SELECT id FROM attendance_break WHERE attendance_id = ? AND end_at IS NULL", (aid,))
        if open_b:
            db.update("attendance_break", {"id": open_b["id"]}, {"end_at": now_iso()})
        else:
            db.insert("attendance_break", {"id": new_id("brk"), "attendance_id": aid, "start_at": now_iso()})
        return db.all("SELECT * FROM attendance_break WHERE attendance_id = ? ORDER BY start_at", (aid,))


@router.get("/attendance")
def attendance(date: str, p: Principal = Depends(require("hr.view")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM attendance_record WHERE branch_id = ? AND work_date = ? ORDER BY scheduled_start", (branch_of(p), date))


@router.post("/payroll/{month}/calculate")
def calculate(month: str, branch: str | None = None, p: Principal = Depends(require("hr.payroll_run")), db: Db = Depends(get_db)):
    with db.tx():
        run = s.calculate_payroll(db, p.actor, month, branch)
        run["payslips"] = db.all("SELECT * FROM payslip WHERE payroll_run_id = ?", (run["id"],))
        return run


@router.post("/payroll/runs/{run_id}/approve")
def approve(run_id: str, p: Principal = Depends(require("hr.payroll_approve")), db: Db = Depends(get_db)):
    with db.tx():
        return s.approve_payroll(db, p.actor, run_id)


@router.post("/payroll/runs/{run_id}/pay")
def pay(run_id: str, account_id: str, p: Principal = Depends(require("fin.bill_pay")), db: Db = Depends(get_db)):
    with db.tx():
        return s.pay_payroll(db, p.actor, run_id, account_id)


@router.get("/performance-logs")
def logs(employee_id: str | None = None, p: Principal = Depends(require("hr.view", "hr.performance_log")), db: Db = Depends(get_db)):
    return db.all("""SELECT * FROM performance_log WHERE org_id = ? AND deleted_at IS NULL AND (CAST(? AS text) IS NULL OR employee_id = ?)
                     ORDER BY logged_at DESC""", (p.actor.org_id, employee_id, employee_id))


@router.post("/performance-logs", status_code=201)
def add_log(body: LogIn, p: Principal = Depends(require("hr.performance_log")), db: Db = Depends(get_db)):
    with db.tx():
        lid = new_id("pl")
        db.insert("performance_log", {"id": lid, "org_id": p.actor.org_id, "employee_id": body.employeeId, "branch_id": p.actor.branch_id,
                                      "log_type": body.type, "rating": body.rating, "severity": body.severity, "note": body.note,
                                      "source": "MANAGER_MODULE" if p.actor.role == "BRANCH_MANAGER" else "HR",
                                      "ref_type": "external" if body.reference else None, "ref_id": body.reference, "logged_by": p.actor.user_id})
        s.audit(db, p.actor, "HR", "performance_log.create", "performance_log", lid, "{type} logged", {"type": body.type})
        return db.one("SELECT * FROM performance_log WHERE id = ?", (lid,))
