/* =========================================================
   Deterministic sample data, relative to today:
   staff across three branches, a 6-week schedule (4 back, this
   week, next week), attendance built from the schedule (late
   arrivals, breaks, overtime, absences, people on shift right now),
   and performance logs — including
   void incidents linked from the Branch Manager Dashboard.
   ========================================================= */

import type {
  AttendanceRecord, EmployeeProfile, PayrollRun, PerformanceLog, ScheduleEntry, ShiftCode,
} from "./types";
import { LATE_GRACE_MIN, NORMAL_DAY_HOURS, OT_DAY, OT_NIGHT, OT_REST_DAY, SHIFTS } from "./catalog";
import { addDays, parseDay, stamp, today } from "./format";

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedData {
  employees: EmployeeProfile[];
  schedule: ScheduleEntry[];
  attendance: AttendanceRecord[];
  logs: PerformanceLog[];
  payroll: PayrollRun[];
}

const B = "BR-BOLE-01";

function emp(id: string, fullName: string, role: EmployeeProfile["role"], phone: string, payType: "HOURLY" | "MONTHLY", rate: number, branchId = B,
  extra: Partial<EmployeeProfile> = {}): EmployeeProfile {
  const monthly = payType === "MONTHLY" ? rate : undefined;
  const hourly = payType === "MONTHLY" ? Math.round((rate / 208) * 100) / 100 : rate;
  const first = fullName.split(" ")[0].toLowerCase();
  return {
    id, fullName, role, phone, hourlyRate: hourly, monthlySalary: monthly, branchId, status: "ACTIVE",
    email: `${first}@bistroaddis.et`, hireDate: "2024-03-01", payType, ...extra,
  };
}

export const EMPLOYEES_SEED: EmployeeProfile[] = [
  emp("EMP-001", "Hanna Tesfaye", "BRANCH_MANAGER", "+251 911 234 567", "MONTHLY", 28000, B, { hireDate: "2021-09-15" }),
  emp("EMP-002", "Abebe Kebede", "ADMIN", "+251 911 765 432", "MONTHLY", 32000, B, { hireDate: "2020-01-10" }),
  emp("EMP-003", "Dawit Alemu", "INVENTORY_CLERK", "+251 912 345 678", "MONTHLY", 12000, B, { hireDate: "2023-02-01" }),
  emp("EMP-004", "Meron Girma", "SALES_STAFF", "+251 913 456 789", "HOURLY", 42, B, { hireDate: "2022-06-20" }),
  emp("EMP-005", "Chaltu Bekele", "SALES_STAFF", "+251 914 567 890", "HOURLY", 42, B, { hireDate: "2023-01-09" }),
  emp("EMP-006", "Yonas Tadesse", "SALES_STAFF", "+251 915 678 901", "HOURLY", 38, B, { hireDate: "2024-05-13" }),
  emp("EMP-007", "Selam Hailu", "SALES_STAFF", "+251 916 789 012", "HOURLY", 36, B, { hireDate: "2025-02-03" }),
  emp("EMP-008", "Lensa Tola", "SALES_STAFF", "+251 917 890 123", "HOURLY", 36, B, { hireDate: "2025-07-21" }),
  emp("EMP-009", "Tigist Mengistu", "KITCHEN_STAFF", "+251 918 901 234", "MONTHLY", 16000, B, { hireDate: "2021-11-01" }),
  emp("EMP-010", "Biruk Assefa", "KITCHEN_STAFF", "+251 919 012 345", "HOURLY", 48, B, { hireDate: "2022-08-08" }),
  emp("EMP-011", "Kedir Mohammed", "KITCHEN_STAFF", "+251 920 123 456", "HOURLY", 45, B, { hireDate: "2023-04-17" }),
  emp("EMP-012", "Hirut Wolde", "KITCHEN_STAFF", "+251 921 234 567", "HOURLY", 40, B, { hireDate: "2024-01-15" }),
  emp("EMP-013", "Gemechu Fikadu", "KITCHEN_STAFF", "+251 922 345 678", "HOURLY", 40, B, { hireDate: "2024-10-01" }),
  emp("EMP-014", "Mulu Desta", "KITCHEN_STAFF", "+251 923 456 789", "HOURLY", 32, B, { hireDate: "2025-03-10" }),
  emp("EMP-015", "Samuel Girma", "SALES_STAFF", "+251 924 567 890", "HOURLY", 36, B, { hireDate: "2023-06-01", status: "INACTIVE" }),
  emp("EMP-016", "Rahel Bekele", "BRANCH_MANAGER", "+251 925 678 901", "MONTHLY", 27000, "BR-PIASSA-02", { hireDate: "2022-02-14" }),
  emp("EMP-017", "Tolosa Bayisa", "SALES_STAFF", "+251 926 789 012", "HOURLY", 38, "BR-PIASSA-02", { hireDate: "2024-09-02" }),
  emp("EMP-018", "Eden Haile", "SALES_STAFF", "+251 927 890 123", "HOURLY", 38, "BR-CMC-03", { hireDate: "2025-01-20" }),
];

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = parseDay(day).getDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** "HH:MM" on a given day as an ISO timestamp. */
export const at = (day: string, hhmm: string, plusMin = 0): string => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(new Date(stamp(day, h, m)).getTime() + plusMin * 60_000).toISOString();
};

export function overtimeMultiplier(day: string, clockOutIso?: string): number {
  if (parseDay(day).getDay() === 0) return OT_REST_DAY;
  if (clockOutIso && new Date(clockOutIso).getHours() >= 22) return OT_NIGHT;
  return OT_DAY;
}

/** Hours worked = clock-in to clock-out (or now) minus breaks. */
export function workedHours(r: Pick<AttendanceRecord, "clockIn" | "clockOut" | "breaks">, nowMs = Date.now()): number {
  if (!r.clockIn) return 0;
  const end = r.clockOut ? new Date(r.clockOut).getTime() : nowMs;
  let ms = end - new Date(r.clockIn).getTime();
  for (const b of r.breaks) ms -= (b.end ? new Date(b.end).getTime() : nowMs) - new Date(b.start).getTime();
  return Math.max(0, ms / 3_600_000);
}

export function generateSeed(): SeedData {
  const r = rng(20261107);
  const now = today();
  const nowMs = Date.now();
  const between = (a: number, b: number): number => Math.round(a + r() * (b - a));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const out: SeedData = { employees: EMPLOYEES_SEED.map((e) => ({ ...e })), schedule: [], attendance: [], logs: [], payroll: [] };
  const active = out.employees.filter((e) => e.status === "ACTIVE");

  /* ---------- schedule: 6 days a week, one rotating day off ---------- */
  const firstWeek = addDays(weekStart(now), -28);
  for (let w = 0; w < 6; w++) {
    const monday = addDays(firstWeek, w * 7);
    active.forEach((e, i) => {
      const off = (i + w) % 7; // rotating day off
      for (let d = 0; d < 7; d++) {
        if (d === off) continue;
        let shift: ShiftCode;
        if (e.role === "BRANCH_MANAGER" || e.role === "ADMIN") shift = "DAY";
        else if (e.role === "INVENTORY_CLERK") shift = "MORNING";
        else if (e.role === "SALES_STAFF") shift = (i + w) % 2 ? "EVENING" : "MORNING";
        else shift = (["MORNING", "DAY", "EVENING"] as const)[(i + w) % 3];
        out.schedule.push({ id: newId("sch"), employeeId: e.id, date: addDays(monday, d), shift });
      }
    });
  }
  // the inactive employee had shifts until he left
  const sam = out.employees.find((e) => e.id === "EMP-015");
  if (sam) for (let d = 0; d < 12; d++) if (d % 7 !== 3) out.schedule.push({ id: newId("sch"), employeeId: sam.id, date: addDays(firstWeek, d), shift: "EVENING" });

  /* ---------- attendance from the schedule ---------- */
  for (const s of out.schedule) {
    if (s.date > now) continue;
    const e = out.employees.find((x) => x.id === s.employeeId);
    if (!e) continue;
    const tpl = SHIFTS[s.shift];
    const sStart = at(s.date, tpl.start);
    const sEnd = at(s.date, tpl.end);
    const base: AttendanceRecord = {
      id: newId("att"), employeeId: e.id, employeeName: e.fullName, shiftDate: s.date, clockIn: "", overtimeHours: 0, status: "SCHEDULED",
      shift: s.shift, scheduledStart: sStart, scheduledEnd: sEnd, breaks: [], lateMinutes: 0, overtimeMultiplier: overtimeMultiplier(s.date), loggedBy: e.id,
    };
    if (new Date(sStart).getTime() > nowMs) { out.attendance.push(base); continue; } // still to come today

    if (r() < 0.035 && s.date < now) { out.attendance.push({ ...base, status: "ABSENT", loggedBy: "EMP-001" }); continue; }
    const lateRoll = r();
    const offset = lateRoll < 0.72 ? between(-12, 3) : lateRoll < 0.92 ? between(6, 15) : between(16, 45);
    const clockIn = at(s.date, tpl.start, offset);
    const breakAt = between(200, 260);
    const breakLen = between(28, 45);
    const breakStart = at(s.date, tpl.start, breakAt);
    const breakEnd = at(s.date, tpl.start, breakAt + breakLen);
    const overtime = r() < 0.16 ? between(1, 3) : 0;
    const clockOut = at(s.date, tpl.end, overtime * 60 + between(-5, 12));
    const rec: AttendanceRecord = { ...base, clockIn, lateMinutes: offset > LATE_GRACE_MIN ? offset : 0, status: "CLOCKED_IN" };
    if (new Date(breakStart).getTime() < nowMs) {
      rec.breaks = [{ start: breakStart, end: new Date(breakEnd).getTime() < nowMs ? breakEnd : undefined }];
    }
    if (new Date(clockOut).getTime() <= nowMs) {
      rec.clockOut = clockOut;
      rec.status = "COMPLETED";
      if (rec.breaks[0] && !rec.breaks[0].end) rec.breaks[0].end = new Date(new Date(rec.breaks[0].start).getTime() + breakLen * 60_000).toISOString();
      const worked = workedHours(rec);
      rec.overtimeHours = Math.max(0, Math.round((worked - NORMAL_DAY_HOURS) * 4) / 4);
      rec.overtimeMultiplier = overtimeMultiplier(s.date, clockOut);
    }
    out.attendance.push(rec);
  }

  /* ---------- performance & discipline ---------- */
  const log = (employeeId: string, type: PerformanceLog["type"], daysAgo: number, note: string, extra: Partial<PerformanceLog> = {}): void => {
    out.logs.push({ id: newId("log"), employeeId, type, severity: "LOW", note, source: "HR", loggedBy: "EMP-001", timestamp: at(addDays(now, -daysAgo), "17:30"), ...extra });
  };
  const reviewNotes = [
    "Consistent service, good upselling of coffee ceremony.",
    "Reliable and calm during rush hours.",
    "Needs to improve speed at closing; otherwise solid.",
    "Strong teamwork; trains new staff well.",
    "Good knife skills and clean station.",
  ];
  for (const e of active) if (e.branchId === B && e.role !== "ADMIN") log(e.id, "REVIEW", between(20, 34), pick(reviewNotes), { rating: between(3, 5) });
  log("EMP-004", "COMMENDATION", 6, "Handled a 40-person catering order without a single complaint.", { severity: "LOW" });
  log("EMP-010", "COMMENDATION", 11, "Covered a double shift when a colleague was sick.");
  log("EMP-006", "VOID_INCIDENT", 2, "Voided a paid ticket without manager approval.", { source: "MANAGER_MODULE", reference: "T-52144", severity: "MEDIUM", loggedBy: "EMP-001" });
  log("EMP-006", "VOID_INCIDENT", 9, "Order cancelled after kitchen had started cooking.", { source: "MANAGER_MODULE", reference: "T-51873", severity: "LOW" });
  log("EMP-007", "VOID_INCIDENT", 5, "Wrong item rung up; ticket voided and re-entered.", { source: "MANAGER_MODULE", reference: "T-52011", severity: "LOW" });
  log("EMP-005", "VOID_INCIDENT", 14, "Customer walked out; ticket cancelled.", { source: "MANAGER_MODULE", reference: "T-51502", severity: "LOW" });
  log("EMP-013", "LATENESS", 4, "Arrived 40 minutes late without calling ahead.", { severity: "MEDIUM" });
  log("EMP-013", "WARNING", 3, "First written warning for repeated lateness.", { severity: "HIGH", loggedBy: "EMP-001" });
  log("EMP-012", "INCIDENT", 8, "Minor burn at the injera station; first aid given, back to work same day.", { severity: "MEDIUM" });
  log("EMP-015", "WARNING", 30, "Final warning before contract ended.", { severity: "HIGH" });
  out.logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  /* ---------- payroll runs ---------- */
  const thisMonth = now.slice(0, 7);
  const d = parseDay(now);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  out.payroll.push({ month: prevMonth, status: "APPROVED", approvedBy: "EMP-001", approvedAt: at(`${thisMonth}-01`, "10:20") });
  out.payroll.push({ month: thisMonth, status: "DRAFT" });

  return out;
}
