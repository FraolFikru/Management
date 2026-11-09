/* =========================================================
   State, data and HR calculations.
   - Every write goes through a function here and is stamped with
     the signed-in user's staff ID.
   - Payroll: base pay + overtime × multiplier − PAYE − 7% pension.
   ========================================================= */

import type {
  AttendanceRecord, EmployeeProfile, FieldErrors, LogType, Payslip, PerformanceLog, ScheduleEntry, ShiftCode, SupportedLanguage,
  UserRole, ViewId,
} from "./types";
import { LATE_GRACE_MIN, MONTH_HOURS, NORMAL_DAY_HOURS, PENSION_EMPLOYEE, PENSION_EMPLOYER, SHIFTS, incomeTax } from "./catalog";
import { at, generateSeed, newId, overtimeMultiplier, weekStart, workedHours } from "./seed";
import { addDays, dayOf, localDay, parseDay, round2, today } from "./format";

/* ---------- UI state ---------- */

export type Modal =
  | { kind: "employee"; id: string | null }
  | { kind: "profile"; id: string }
  | { kind: "log"; employeeId: string | null }
  | { kind: "absent"; id: string }
  | null;

export interface UiState {
  lang: SupportedLanguage;
  theme: "dark" | "light";
  userId: string;
  view: ViewId;
  branch: string;
  staffQuery: string;
  staffRole: UserRole | "ALL";
  staffStatus: "ACTIVE" | "INACTIVE" | "ALL";
  week: string;
  attDay: string;
  payMonth: string;
  payOpen: string | null;
  logType: LogType | "ALL";
  logEmployee: string;
  modal: Modal;
  errors: FieldErrors;
  userMenu: boolean;
}

const PREFS_KEY = "hr-staff-management-v1";
function loadPrefs(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}
const prefs = loadPrefs();

/** People who can use the HR module (sign-off on payroll, schedules, logs). */
export const HR_USERS = ["EMP-001", "EMP-002"];

export const state: UiState = {
  lang: prefs.lang === "am" || prefs.lang === "om" ? prefs.lang : "en",
  theme: prefs.theme === "light" ? "light" : "dark",
  userId: HR_USERS.includes(prefs.userId ?? "") ? (prefs.userId as string) : "EMP-001",
  view: "today",
  branch: "BR-BOLE-01",
  staffQuery: "",
  staffRole: "ALL",
  staffStatus: "ACTIVE",
  week: weekStart(today()),
  attDay: today(),
  payMonth: today().slice(0, 7),
  payOpen: null,
  logType: "ALL",
  logEmployee: "ALL",
  modal: null,
  errors: {},
  userMenu: false,
};

export function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, theme: state.theme, userId: state.userId }));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

/* ---------- data ---------- */

const seed = generateSeed();
export const db = {
  employees: seed.employees,
  schedule: seed.schedule,
  attendance: seed.attendance,
  logs: seed.logs,
  payroll: seed.payroll,
};

export const employee = (id: string): EmployeeProfile | undefined => db.employees.find((e) => e.id === id);
export const user = (): EmployeeProfile => employee(state.userId) ?? db.employees[0];
export const nameOf = (id: string): string => employee(id)?.fullName ?? id;
export const initials = (name: string): string => name.split(/\s+/).map((p) => p[0] ?? "").slice(0, 2).join("").toUpperCase();
export const branchStaff = (includeInactive = false): EmployeeProfile[] =>
  db.employees.filter((e) => e.branchId === state.branch && (includeInactive || e.status === "ACTIVE"));

/* ---------- employees ---------- */

export function saveEmployee(data: Omit<EmployeeProfile, "id">, id: string | null): EmployeeProfile {
  if (id) {
    const e = employee(id);
    if (e) { Object.assign(e, data); return e; }
  }
  const n = db.employees.length + 1;
  const e: EmployeeProfile = { ...data, id: `EMP-${String(n).padStart(3, "0")}` };
  while (employee(e.id)) e.id = `EMP-${String(Number(e.id.slice(4)) + 1).padStart(3, "0")}`;
  db.employees.push(e);
  return e;
}

export function setStatus(id: string, status: EmployeeProfile["status"]): void {
  const e = employee(id);
  if (!e) return;
  e.status = status;
  if (status === "INACTIVE") db.schedule = db.schedule.filter((s) => !(s.employeeId === id && s.date > today()));
}

/* ---------- schedule ---------- */

export const weekDays = (monday = state.week): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const entryFor = (employeeId: string, date: string): ScheduleEntry | undefined =>
  db.schedule.find((s) => s.employeeId === employeeId && s.date === date);

/** Assign (or replace) one person's shift on a day; null clears it. Past days are locked. */
export function setShift(employeeId: string, date: string, shift: ShiftCode | null): boolean {
  if (date < today()) return false;
  const existing = entryFor(employeeId, date);
  if (shift === null) { if (existing) db.schedule = db.schedule.filter((s) => s !== existing); }
  else if (existing) existing.shift = shift;
  else db.schedule.push({ id: newId("sch"), employeeId, date, shift });
  if (date === today()) syncToday(employeeId);
  return true;
}

export function moveShift(fromEmp: string, fromDate: string, toEmp: string, toDate: string): boolean {
  const e = entryFor(fromEmp, fromDate);
  if (!e || toDate < today() || fromDate < today()) return false;
  if (fromEmp === toEmp && fromDate === toDate) return false;
  const shift = e.shift;
  setShift(fromEmp, fromDate, null);
  return setShift(toEmp, toDate, shift);
}

/** Copy the previous week's pattern into the shown week (only future days, only empty cells). */
export function copyPreviousWeek(): number {
  let n = 0;
  for (const d of weekDays()) {
    if (d < today()) continue;
    for (const e of branchStaff()) {
      const prev = entryFor(e.id, addDays(d, -7));
      if (prev && !entryFor(e.id, d)) { setShift(e.id, d, prev.shift); n++; }
    }
  }
  return n;
}

export const weekHours = (employeeId: string, monday = state.week): number =>
  weekDays(monday).reduce((s, d) => { const e = entryFor(employeeId, d); return s + (e ? SHIFTS[e.shift].hours : 0); }, 0);

/** Keep today's attendance list in step with the schedule for people who have not clocked in yet. */
function syncToday(employeeId: string): void {
  const day = today();
  const entry = entryFor(employeeId, day);
  const rec = db.attendance.find((a) => a.employeeId === employeeId && a.shiftDate === day);
  if (rec && rec.status !== "SCHEDULED") return;
  if (!entry) { if (rec) db.attendance = db.attendance.filter((a) => a !== rec); return; }
  const tpl = SHIFTS[entry.shift];
  const e = employee(employeeId);
  if (!e) return;
  const fresh: AttendanceRecord = {
    id: rec?.id ?? newId("att"), employeeId, employeeName: e.fullName, shiftDate: day, clockIn: "", overtimeHours: 0, status: "SCHEDULED",
    shift: entry.shift, scheduledStart: at(day, tpl.start), scheduledEnd: at(day, tpl.end), breaks: [], lateMinutes: 0,
    overtimeMultiplier: overtimeMultiplier(day), loggedBy: state.userId,
  };
  if (rec) Object.assign(rec, fresh); else db.attendance.push(fresh);
}

/* ---------- attendance ---------- */

export const attendanceOn = (day: string): AttendanceRecord[] =>
  db.attendance.filter((a) => a.shiftDate === day && employee(a.employeeId)?.branchId === state.branch)
    .sort((a, b) => (a.scheduledStart < b.scheduledStart ? -1 : a.scheduledStart > b.scheduledStart ? 1 : a.employeeName.localeCompare(b.employeeName)));

export const onBreak = (a: AttendanceRecord): boolean => a.status === "CLOCKED_IN" && a.breaks.some((b) => !b.end);
export const breakMinutes = (a: AttendanceRecord, nowMs = Date.now()): number =>
  a.breaks.reduce((s, b) => s + ((b.end ? new Date(b.end).getTime() : nowMs) - new Date(b.start).getTime()) / 60_000, 0);

export function clockIn(id: string): AttendanceRecord | null {
  const a = db.attendance.find((x) => x.id === id);
  if (!a || a.status !== "SCHEDULED") return null;
  const now = new Date();
  a.clockIn = now.toISOString();
  const late = Math.round((now.getTime() - new Date(a.scheduledStart).getTime()) / 60_000);
  a.lateMinutes = late > LATE_GRACE_MIN ? late : 0;
  a.status = "CLOCKED_IN";
  a.loggedBy = state.userId;
  return a;
}

export function toggleBreak(id: string): "start" | "end" | null {
  const a = db.attendance.find((x) => x.id === id);
  if (!a || a.status !== "CLOCKED_IN") return null;
  const open = a.breaks.find((b) => !b.end);
  if (open) { open.end = new Date().toISOString(); return "end"; }
  a.breaks.push({ start: new Date().toISOString() });
  return "start";
}

export function clockOut(id: string): AttendanceRecord | null {
  const a = db.attendance.find((x) => x.id === id);
  if (!a || a.status !== "CLOCKED_IN") return null;
  const nowIso = new Date().toISOString();
  for (const b of a.breaks) if (!b.end) b.end = nowIso;
  a.clockOut = nowIso;
  a.status = "COMPLETED";
  a.overtimeHours = Math.max(0, Math.round((workedHours(a) - NORMAL_DAY_HOURS) * 4) / 4);
  a.overtimeMultiplier = overtimeMultiplier(a.shiftDate, nowIso);
  a.loggedBy = state.userId;
  return a;
}

export function markAbsent(id: string, note: string): AttendanceRecord | null {
  const a = db.attendance.find((x) => x.id === id);
  if (!a || a.status !== "SCHEDULED") return null;
  a.status = "ABSENT";
  a.loggedBy = state.userId;
  if (note) addLog({ employeeId: a.employeeId, type: "INCIDENT", severity: "MEDIUM", note: `Absent ${a.shiftDate}: ${note}`, source: "HR" });
  return a;
}

/** Undo for any attendance button: restore a saved copy. */
export function restoreAttendance(copy: AttendanceRecord): void {
  const a = db.attendance.find((x) => x.id === copy.id);
  if (a) Object.assign(a, copy, { breaks: copy.breaks.map((b) => ({ ...b })) });
}
export const snapshot = (a: AttendanceRecord): AttendanceRecord => ({ ...a, breaks: a.breaks.map((b) => ({ ...b })) });

/* ---------- payroll ---------- */

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  // day 0 of the next month = last day of this month
  return [`${month}-01`, dayOf(new Date(y, m, 0))];
}

export function payslip(e: EmployeeProfile, month: string): Payslip {
  const [from, last] = monthRange(month);
  const to = last < today() ? last : today();
  const recs = db.attendance.filter((a) => a.employeeId === e.id && a.status === "COMPLETED" && a.shiftDate >= from && a.shiftDate <= to);
  let regular = 0, ot = 0, otPay = 0;
  for (const a of recs) {
    const w = workedHours(a);
    regular += Math.min(w, NORMAL_DAY_HOURS);
    ot += a.overtimeHours;
    otPay += a.overtimeHours * e.hourlyRate * a.overtimeMultiplier;
  }
  const prorated = to < last;
  const daysInMonth = parseDay(last).getDate();
  const daysSoFar = parseDay(to).getDate();
  // salaried staff are paid from their hire date; nothing before it
  const startDay = e.hireDate > from ? parseDay(e.hireDate).getDate() : 1;
  const employedDays = e.hireDate > to ? 0 : Math.max(0, daysSoFar - startDay + 1);
  const basePay = e.payType === "MONTHLY"
    ? (e.monthlySalary ?? e.hourlyRate * MONTH_HOURS) * (prorated || startDay > 1 ? employedDays / daysInMonth : 1)
    : regular * e.hourlyRate;
  const grossTaxable = basePay + otPay;
  // PAYE is a monthly scale: month-to-date figures are scaled to a full month, taxed, and scaled back
  const scale = prorated ? daysInMonth / daysSoFar : 1;
  const tax = incomeTax(grossTaxable * scale) / scale;
  const pensionEmployee = basePay * PENSION_EMPLOYEE;
  return {
    employeeId: e.id, regularHours: round2(regular), overtimeHours: round2(ot), basePay: round2(basePay), overtimePay: round2(otPay),
    grossTaxable: round2(grossTaxable), incomeTax: round2(tax), pensionEmployee: round2(pensionEmployee), pensionEmployer: round2(basePay * PENSION_EMPLOYER),
    netPay: round2(grossTaxable - tax - pensionEmployee), prorated,
  };
}

export const payrollRun = (month: string) => {
  let run = db.payroll.find((p) => p.month === month);
  if (!run) { run = { month, status: "DRAFT" }; db.payroll.push(run); }
  return run;
};

export function approvePayroll(month: string): void {
  const run = payrollRun(month);
  run.status = "APPROVED";
  run.approvedBy = state.userId;
  run.approvedAt = new Date().toISOString();
}

export function reopenPayroll(month: string): void {
  const run = payrollRun(month);
  run.status = "DRAFT";
  delete run.approvedBy;
  delete run.approvedAt;
}

/* ---------- performance logs ---------- */

export function addLog(l: Omit<PerformanceLog, "id" | "loggedBy" | "timestamp">): PerformanceLog {
  const rec: PerformanceLog = { ...l, id: newId("log"), loggedBy: state.userId, timestamp: new Date().toISOString() };
  db.logs.unshift(rec);
  return rec;
}
export const removeLog = (id: string): void => { db.logs = db.logs.filter((l) => l.id !== id); };

/** Punctuality over the last 30 days: share of worked shifts that started on time. */
export function punctuality(employeeId: string): { pct: number; late: number; absent: number; shifts: number } {
  const from = addDays(today(), -30);
  const recs = db.attendance.filter((a) => a.employeeId === employeeId && a.shiftDate >= from && a.status !== "SCHEDULED");
  const worked = recs.filter((a) => a.status !== "ABSENT");
  const late = worked.filter((a) => a.lateMinutes > 0).length;
  const absent = recs.length - worked.length;
  return { pct: recs.length ? ((worked.length - late) / recs.length) * 100 : 100, late, absent, shifts: recs.length };
}

export const latestRating = (employeeId: string): number | undefined =>
  db.logs.find((l) => l.employeeId === employeeId && l.type === "REVIEW" && l.rating)?.rating;

export const isToday = (iso: string): boolean => localDay(iso) === today();
