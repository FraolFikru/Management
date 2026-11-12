"""HR & Staff (HR-main): employees, schedule, attendance, payroll, performance."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .. import services as s
from ..auth import hash_secret
from ..db import new_id, now_iso
from . import Db, Depends, Principal, branch_of, get_db, require

router = APIRouter(prefix="/hr", tags=["hr"])


class EmployeeIn(BaseModel):
    id: str | None = None                          # the HR app's own id, so a retry or undo hits the same person
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
    id: str | None = None


TRUSTED = {"ADMIN", "OWNER"}


def _guard_role(p: Principal, role: str) -> None:
    """Only the Owner can give someone System Admin or Owner rights (same rule as the Admin app)."""
    if role in TRUSTED and p.actor.role != "OWNER":
        raise s.Forbidden("only the Owner can give someone the System Admin or Owner role")


@router.get("/employees")
def employees(p: Principal = Depends(require("hr.view")), db: Db = Depends(get_db)):
    """HR-main EmployeeProfile[] — the same people as Admin's user accounts."""
    return db.all("""SELECT e.*, u.full_name, u.role_code, u.phone, u.email, u.home_branch_id, u.staff_code, u.is_active
                     FROM employee e JOIN app_user u ON u.id = e.user_id WHERE e.org_id = ? ORDER BY e.employee_no""", (p.actor.org_id,))


@router.post("/employees", status_code=201)
def hire(body: EmployeeIn, p: Principal = Depends(require("hr.staff_manage")), db: Db = Depends(get_db)):
    """Hiring creates the login account too (no password yet; PIN for terminals)."""
    _guard_role(p, body.role)
    with db.tx():
        if body.id and db.scalar("SELECT 1 FROM app_user WHERE id = ?", (body.id,)):
            return db.one("SELECT * FROM employee WHERE user_id = ?", (body.id,))
        uid = body.id or new_id("usr")
        n = int(db.scalar("SELECT count(*) FROM employee WHERE org_id = ?", (p.actor.org_id,))) + 1
        while db.scalar("SELECT 1 FROM employee WHERE org_id = ? AND employee_no = ?", (p.actor.org_id, f"EMP-{n:03d}")):
            n += 1
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
        if body.id and db.scalar("SELECT 1 FROM performance_log WHERE id = ?", (body.id,)):   # retry, or undo of a delete
            db.update("performance_log", {"id": body.id}, {"deleted_at": None})
            return db.one("SELECT * FROM performance_log WHERE id = ?", (body.id,))
        lid = body.id or new_id("pl")
        db.insert("performance_log", {"id": lid, "org_id": p.actor.org_id, "employee_id": body.employeeId, "branch_id": p.actor.branch_id,
                                      "log_type": body.type, "rating": body.rating, "severity": body.severity, "note": body.note,
                                      "source": "MANAGER_MODULE" if p.actor.role == "BRANCH_MANAGER" else "HR",
                                      "ref_type": "external" if body.reference else None, "ref_id": body.reference, "logged_by": p.actor.user_id})
        s.audit(db, p.actor, "HR", "performance_log.create", "performance_log", lid, "{type} logged", {"type": body.type})
        return db.one("SELECT * FROM performance_log WHERE id = ?", (lid,))


# ---------- editing, schedule upsert, attendance corrections, payroll approve/reopen, log delete ----------

class StatusIn(BaseModel):
    status: Literal["ACTIVE", "INACTIVE"]


@router.put("/employees/{uid}")
def edit_employee(uid: str, body: EmployeeIn, p: Principal = Depends(require("hr.staff_manage")), db: Db = Depends(get_db)):
    with db.tx():
        u = s._get(db, "app_user", uid, p.actor.org_id)
        if body.role != u["role_code"]:
            _guard_role(p, body.role)
            if u["role_code"] in TRUSTED and p.actor.role != "OWNER":
                raise s.Forbidden("only the Owner can change a System Admin's or Owner's role")
        db.update("app_user", {"id": uid}, {"full_name": body.fullName, "role_code": body.role, "phone": body.phone, "email": body.email,
                                            "home_branch_id": body.branchId})
        pay = {"hire_date": body.hireDate, "pay_type": body.payType, "hourly_rate": body.hourlyRate,
               "monthly_salary": body.monthlySalary if body.payType == "MONTHLY" else None}
        if db.scalar("SELECT 1 FROM employee WHERE user_id = ?", (uid,)):
            db.update("employee", {"user_id": uid}, pay)
        else:                                       # an account made in Admin gets its HR record here
            n = int(db.scalar("SELECT count(*) FROM employee WHERE org_id = ?", (p.actor.org_id,))) + 1
            while db.scalar("SELECT 1 FROM employee WHERE org_id = ? AND employee_no = ?", (p.actor.org_id, f"EMP-{n:03d}")):
                n += 1
            db.insert("employee", {"user_id": uid, "org_id": p.actor.org_id, "employee_no": f"EMP-{n:03d}", **pay})
        s.audit(db, p.actor, "HR", "employee.update", "employee", uid, "Updated {name}", {"name": body.fullName})
        return db.one("SELECT * FROM employee WHERE user_id = ?", (uid,))


@router.put("/employees/{uid}/status")
def set_status(uid: str, body: StatusIn, p: Principal = Depends(require("hr.staff_manage")), db: Db = Depends(get_db)):
    """Deactivating also blocks the login and cancels future shifts; reactivating restores the login."""
    with db.tx():
        u = s._get(db, "app_user", uid, p.actor.org_id)
        if uid == p.actor.user_id:
            raise s.ServiceError("you can't deactivate yourself")
        if u["role_code"] in TRUSTED and p.actor.role != "OWNER":
            raise s.Forbidden("only the Owner can deactivate a System Admin or Owner")
        active = body.status == "ACTIVE"
        db.update("app_user", {"id": uid}, {"is_active": active})
        if db.scalar("SELECT 1 FROM employee WHERE user_id = ?", (uid,)):
            db.update("employee", {"user_id": uid}, {"status": body.status, "termination_date": None if active else s.business_date()})
        if not active:
            db.execute("UPDATE schedule_entry SET status = 'CANCELLED' WHERE employee_id = ? AND work_date > ? AND status <> 'CANCELLED'",
                       (uid, s.business_date()))
            db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), uid))
        s.audit(db, p.actor, "HR", f"employee.{'reactivate' if active else 'deactivate'}", "employee", uid, "{name} {status}",
                {"name": u["full_name"], "status": body.status})
        return {"id": uid, "status": body.status}


class ShiftSet(BaseModel):
    employeeId: str
    date: str
    shift: Literal["MORNING", "DAY", "EVENING"] | None = None
    branchId: str | None = None


@router.put("/schedule")
def set_shift(body: ShiftSet, p: Principal = Depends(require("hr.schedule_manage")), db: Db = Depends(get_db)):
    """Put one person on a shift for a day (replacing what was there), or clear the day (shift = null). Past days are locked."""
    if body.date < s.business_date():
        raise s.ServiceError("past days are locked")
    with db.tx():
        u = s._get(db, "app_user", body.employeeId, p.actor.org_id)
        branch = body.branchId or u["home_branch_id"] or branch_of(p)
        rows = db.all("SELECT * FROM schedule_entry WHERE employee_id = ? AND work_date = ?", (body.employeeId, body.date))
        keep = None
        if body.shift:
            keep = next((r for r in rows if r["shift_code"] == body.shift), None) or next((r for r in rows if r["status"] != "CANCELLED"), None)
            if keep:
                db.update("schedule_entry", {"id": keep["id"]}, {"shift_code": body.shift, "status": "PUBLISHED", "branch_id": branch})
            else:
                keep = {"id": new_id("sch")}
                db.insert("schedule_entry", {"id": keep["id"], "org_id": p.actor.org_id, "branch_id": branch, "employee_id": body.employeeId,
                                             "work_date": body.date, "shift_code": body.shift, "status": "PUBLISHED", "created_by": p.actor.user_id})
        for r in rows:
            if (not keep or r["id"] != keep["id"]) and r["status"] != "CANCELLED":
                db.update("schedule_entry", {"id": r["id"]}, {"status": "CANCELLED"})
        s.audit(db, p.actor, "HR", "schedule_entry.set", "schedule_entry", keep["id"] if keep else None,
                "{name}: {shift} on {date}", {"name": u["full_name"], "shift": body.shift or "off", "date": body.date}, branch_id=branch)
        return db.one("SELECT * FROM schedule_entry WHERE id = ?", (keep["id"],)) if keep else {"employeeId": body.employeeId, "date": body.date, "shift": None}


def _window(db: Db, org: str, day: str, code: str) -> tuple[str, str]:
    t = db.one("SELECT * FROM shift_template WHERE org_id = ? AND code = ? AND branch_id IS NULL", (org, code))
    st = datetime.fromisoformat(f"{day}T{str(t['start_time'])[:5]}").replace(tzinfo=s.ADDIS)
    en = datetime.fromisoformat(f"{day}T{str(t['end_time'])[:5]}").replace(tzinfo=s.ADDIS)
    if en <= st:
        en += timedelta(days=1)
    return st.astimezone(timezone.utc).isoformat(), en.astimezone(timezone.utc).isoformat()


class AbsentIn(BaseModel):
    employeeId: str
    date: str
    shift: Literal["MORNING", "DAY", "EVENING"]


@router.post("/attendance/absent")
def mark_absent(body: AbsentIn, p: Principal = Depends(require("hr.attendance_manage")), db: Db = Depends(get_db)):
    with db.tx():
        u = s._get(db, "app_user", body.employeeId, p.actor.org_id)
        rec = db.one("SELECT * FROM attendance_record WHERE employee_id = ? AND work_date = ? AND shift_code = ?", (body.employeeId, body.date, body.shift))
        if rec and rec["status"] not in ("SCHEDULED", "ABSENT"):
            raise s.Conflict("already clocked in for this shift")
        if rec:
            db.update("attendance_record", {"id": rec["id"]}, {"status": "ABSENT", "logged_by": p.actor.user_id})
            aid = rec["id"]
        else:
            st, en = _window(db, p.actor.org_id, body.date, body.shift)
            entry = db.scalar("SELECT id FROM schedule_entry WHERE employee_id = ? AND work_date = ? AND shift_code = ? AND status <> 'CANCELLED'",
                              (body.employeeId, body.date, body.shift))
            aid = new_id("att")
            db.insert("attendance_record", {"id": aid, "org_id": p.actor.org_id, "branch_id": u["home_branch_id"] or branch_of(p),
                                            "employee_id": body.employeeId, "schedule_entry_id": entry, "work_date": body.date,
                                            "shift_code": body.shift, "scheduled_start": st, "scheduled_end": en, "status": "ABSENT",
                                            "clock_method": "MANAGER", "logged_by": p.actor.user_id})
        s.audit(db, p.actor, "HR", "attendance.absent", "attendance_record", aid, "{name} absent ({shift})", {"name": u["full_name"], "shift": body.shift})
        return db.one("SELECT * FROM attendance_record WHERE id = ?", (aid,))


class BreakOut(BaseModel):
    start: str
    end: str | None = None


class RestoreIn(BaseModel):
    employeeId: str
    date: str
    shift: Literal["MORNING", "DAY", "EVENING"]
    status: Literal["SCHEDULED", "CLOCKED_IN", "COMPLETED", "ABSENT"]
    clockIn: str | None = None
    clockOut: str | None = None
    lateMinutes: int = 0
    overtimeHours: float = 0
    overtimeMultiplier: float = 1.5
    breaks: list[BreakOut] = []


@router.put("/attendance/restore")
def restore_attendance(body: RestoreIn, p: Principal = Depends(require("hr.attendance_manage")), db: Db = Depends(get_db)):
    """Undo of a clock button: put the shift back exactly as it was a moment ago (yesterday and today only)."""
    if body.date < (date.fromisoformat(s.business_date()) - timedelta(days=1)).isoformat():
        raise s.ServiceError("only today's and yesterday's attendance can be undone")
    with db.tx():
        rec = db.one("SELECT * FROM attendance_record WHERE employee_id = ? AND work_date = ? AND shift_code = ?", (body.employeeId, body.date, body.shift))
        if not rec:
            return {"status": body.status}
        if body.status == "SCHEDULED":
            db.execute("DELETE FROM attendance_break WHERE attendance_id = ?", (rec["id"],))
            db.execute("DELETE FROM performance_log WHERE source = 'SYSTEM' AND ref_type = 'attendance_record' AND ref_id = ?", (rec["id"],))
            db.execute("DELETE FROM attendance_record WHERE id = ?", (rec["id"],))
        else:
            db.update("attendance_record", {"id": rec["id"]}, {"status": body.status, "clock_in": body.clockIn, "clock_out": body.clockOut,
                                                              "late_minutes": body.lateMinutes, "overtime_hours": body.overtimeHours,
                                                              "overtime_multiplier": body.overtimeMultiplier, "logged_by": p.actor.user_id})
            db.execute("DELETE FROM attendance_break WHERE attendance_id = ?", (rec["id"],))
            for b in body.breaks:
                db.insert("attendance_break", {"id": new_id("brk"), "attendance_id": rec["id"], "start_at": b.start, "end_at": b.end})
        s.audit(db, p.actor, "HR", "attendance.undo", "attendance_record", rec["id"], "Attendance undone ({status})", {"status": body.status})
        return {"status": body.status}


def _run(db: Db, org: str, month: str, branch: str | None) -> dict | None:
    return db.one("SELECT * FROM payroll_run WHERE org_id = ? AND period_month = ? AND coalesce(branch_id, '-') = ? AND status <> 'VOID'",
                  (org, f"{month[:7]}-01", branch or "-"))


@router.post("/payroll/{month}/approve")
def approve_month(month: str, branch: str | None = None, p: Principal = Depends(require("hr.payroll_approve")), db: Db = Depends(get_db)):
    """Calculate the month's payslips for the branch and approve them in one step (Finance then sees the payroll cost)."""
    with db.tx():
        r = _run(db, p.actor.org_id, month, branch)
        if r and r["status"] in ("APPROVED", "PAID"):
            return r
        run = s.calculate_payroll(db, p.actor, month[:7], branch)
        return s.approve_payroll(db, p.actor, run["id"])


@router.post("/payroll/{month}/reopen")
def reopen_month(month: str, branch: str | None = None, p: Principal = Depends(require("hr.payroll_approve")), db: Db = Depends(get_db)):
    with db.tx():
        r = _run(db, p.actor.org_id, month, branch)
        if not r or r["status"] == "DRAFT":
            return r or {"status": "DRAFT"}
        if r["status"] == "PAID":
            raise s.Conflict("this payroll was already paid by Finance and can't be reopened")
        db.update("payroll_run", {"id": r["id"]}, {"status": "DRAFT", "approved_by": None, "approved_at": None})
        s.audit(db, p.actor, "HR", "payroll_run.reopen", "payroll_run", r["id"], "Payroll {month} reopened", {"month": month[:7]})
        return db.one("SELECT * FROM payroll_run WHERE id = ?", (r["id"],))


@router.delete("/performance-logs/{lid}")
def delete_log(lid: str, p: Principal = Depends(require("hr.performance_log")), db: Db = Depends(get_db)):
    with db.tx():
        s._get(db, "performance_log", lid, p.actor.org_id)
        db.update("performance_log", {"id": lid}, {"deleted_at": now_iso()})
        s.audit(db, p.actor, "HR", "performance_log.delete", "performance_log", lid, "Log removed", {})
        return {"id": lid}


# ---------- one call that fills the HR app (same shapes as HR-main types.ts) ----------

HR_ROLE_OK = {"HR_OFFICER", "ADMIN", "OWNER", "BRANCH_MANAGER"}


@router.get("/bootstrap")
def hr_bootstrap(p: Principal = Depends(require("hr.view")), db: Db = Depends(get_db)):
    org = p.actor.org_id
    iso = s._iso
    since = (date.fromisoformat(s.business_date()) - timedelta(days=42)).isoformat()
    branches = [{"id": b["id"], "name": b["name"]} for b in db.all("SELECT id, name FROM branch WHERE org_id = ? AND deleted_at IS NULL ORDER BY name", (org,))]
    employees = []
    for u in db.all("""SELECT u.*, e.hire_date, e.pay_type, e.hourly_rate, e.monthly_salary, e.status AS emp_status, e.employee_no
                       FROM app_user u LEFT JOIN employee e ON e.user_id = u.id WHERE u.org_id = ? AND u.deleted_at IS NULL""", (org,)):
        active = bool(u["is_active"]) and (u["emp_status"] in (None, "ACTIVE"))
        employees.append({"id": u["id"], "fullName": u["full_name"], "role": u["role_code"], "phone": u["phone"] or "", "email": u["email"] or "",
                          "hourlyRate": float(u["hourly_rate"] or 0), **({"monthlySalary": float(u["monthly_salary"])} if u["monthly_salary"] is not None else {}),
                          "branchId": u["home_branch_id"] or (branches[0]["id"] if branches else ""), "status": "ACTIVE" if active else "INACTIVE",
                          "hireDate": str(u["hire_date"] or u["created_at"])[:10], "payType": u["pay_type"] or "HOURLY",
                          "staffNo": u["employee_no"] or u["staff_code"] or ""})
    names = {e["id"]: e["fullName"] for e in employees}
    schedule = [{"id": r["id"], "employeeId": r["employee_id"], "date": str(r["work_date"])[:10], "shift": r["shift_code"]}
                for r in db.all("SELECT * FROM schedule_entry WHERE org_id = ? AND work_date >= ? AND status <> 'CANCELLED'", (org, since))]
    breaks: dict[str, list] = {}
    for b in db.all("""SELECT b.* FROM attendance_break b JOIN attendance_record a ON a.id = b.attendance_id
                       WHERE a.org_id = ? AND a.work_date >= ? ORDER BY b.start_at""", (org, since)):
        breaks.setdefault(b["attendance_id"], []).append({"start": iso(b["start_at"]), **({"end": iso(b["end_at"])} if b["end_at"] else {})})
    attendance = []
    seen = set()
    for a in db.all("SELECT * FROM attendance_record WHERE org_id = ? AND work_date >= ?", (org, since)):
        d = str(a["work_date"])[:10]
        seen.add((a["employee_id"], d, a["shift_code"]))
        attendance.append({"id": a["id"], "employeeId": a["employee_id"], "employeeName": names.get(a["employee_id"], a["employee_id"]),
                           "shiftDate": d, "clockIn": iso(a["clock_in"]) if a["clock_in"] else "", **({"clockOut": iso(a["clock_out"])} if a["clock_out"] else {}),
                           "overtimeHours": float(a["overtime_hours"] or 0), "status": a["status"], "shift": a["shift_code"],
                           "scheduledStart": iso(a["scheduled_start"]), "scheduledEnd": iso(a["scheduled_end"]), "breaks": breaks.get(a["id"], []),
                           "lateMinutes": int(a["late_minutes"] or 0), "overtimeMultiplier": float(a["overtime_multiplier"] or 1.5),
                           "loggedBy": a["logged_by"] or ""})
    today = s.business_date()
    sunday = date.fromisoformat(today).weekday() == 6
    for r in schedule:                              # today's planned shifts nobody has clocked yet
        if r["date"] == today and (r["employeeId"], today, r["shift"]) not in seen:
            st, en = _window(db, org, today, r["shift"])
            attendance.append({"id": f"sched-{r['id']}", "employeeId": r["employeeId"], "employeeName": names.get(r["employeeId"], ""),
                               "shiftDate": today, "clockIn": "", "overtimeHours": 0, "status": "SCHEDULED", "shift": r["shift"],
                               "scheduledStart": st, "scheduledEnd": en, "breaks": [], "lateMinutes": 0,
                               "overtimeMultiplier": 2.0 if sunday else 1.5, "loggedBy": ""})
    logs = [{"id": l["id"], "employeeId": l["employee_id"], "type": l["log_type"], **({"rating": int(l["rating"])} if l["rating"] is not None else {}),
             "severity": l["severity"] or "LOW", "note": l["note"] or "", "source": "MANAGER_MODULE" if l["source"] == "MANAGER_MODULE" else "HR",
             **({"reference": l["ref_id"]} if l["ref_type"] == "external" and l["ref_id"] else {}), "loggedBy": l["logged_by"] or "",
             "timestamp": iso(l["logged_at"])}
            for l in db.all("SELECT * FROM performance_log WHERE org_id = ? AND deleted_at IS NULL ORDER BY logged_at DESC", (org,))]
    payroll = [{"month": str(r["period_month"])[:7], "status": "DRAFT" if r["status"] == "DRAFT" else "APPROVED",
                **({"branchId": r["branch_id"]} if r["branch_id"] else {}), **({"paid": True} if r["status"] == "PAID" else {}),
                **({"approvedBy": r["approved_by"], "approvedAt": iso(r["approved_at"])} if r["approved_by"] else {})}
               for r in db.all("SELECT * FROM payroll_run WHERE org_id = ? AND status <> 'VOID'", (org,))]
    my_branch = p.actor.branch_id or next((e["branchId"] for e in employees if e["id"] == p.actor.user_id), None) or (branches[0]["id"] if branches else "")
    return {"role": p.actor.role if p.actor.role in HR_ROLE_OK else None, "branch": my_branch, "branches": branches, "employees": employees,
            "schedule": schedule, "attendance": attendance, "logs": logs, "payroll": payroll}
