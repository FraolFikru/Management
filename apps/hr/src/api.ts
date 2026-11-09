/* =========================================================
   Connection to the Eirsha Ops backend.

   VITE_API_URL set   → sign in with a real account; staff, shifts, clock-ins,
                        payroll and performance logs are the real ones and
                        every change is saved.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type { AttendanceRecord, EmployeeProfile, PayrollRun, PerformanceLog, ScheduleEntry, ShiftCode } from "./types";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string; initials?: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "eirsha.hr.session";
let session: Session | null = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null; } catch { return null; }
})();

function save(s: Session | null): void {
  session = s;
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* memory only */ }
}

export const sessionUser = (): SessionUser | null => session?.user ?? null;

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (session) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (session.user.branchId) headers.set("X-Branch-Id", session.user.branchId);
  }
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function refresh(): Promise<boolean> {
  if (!session) return false;
  const res = await raw("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) });
  if (!res.ok) { save(null); return false; }
  const s = (await res.json()) as Session;
  save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
  return true;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && (await refresh())) res = await raw(path, init);
  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error ?? (typeof body.detail === "string" ? body.detail : msg);
    } catch { /* not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown): Promise<T> => api<T>(path, { method: "POST", body: JSON.stringify(body) });

/* ---------- session ---------- */

export async function signIn(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  if (!res.ok) throw new ApiError(res.status === 401 ? "wrong" : `Server error (${res.status})`, res.status);
  const s = (await res.json()) as Session;
  save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
}

export async function signOut(): Promise<void> {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* already expired */ }
  save(null);
}

/* ---------- load ---------- */

export interface Bootstrap {
  /** null = this account can't use the HR app */
  role: string | null;
  /** the signed-in user's branch (shown first) */
  branch: string;
  branches: { id: string; name: string }[];
  employees: (EmployeeProfile & { staffNo?: string })[];
  schedule: ScheduleEntry[];
  attendance: AttendanceRecord[];
  logs: PerformanceLog[];
  payroll: PayrollRun[];
}

export const loadAll = (): Promise<Bootstrap> => api<Bootstrap>("/hr/bootstrap");

/* ---------- writes ---------- */

const enc = encodeURIComponent;
const put = <T>(path: string, body: unknown): Promise<T> => api<T>(path, { method: "PUT", body: JSON.stringify(body) });

const employeeBody = (e: EmployeeProfile) => ({
  id: e.id, fullName: e.fullName, role: e.role, phone: e.phone || null, email: e.email || null, branchId: e.branchId,
  hireDate: e.hireDate, payType: e.payType, hourlyRate: e.hourlyRate, monthlySalary: e.payType === "MONTHLY" ? e.monthlySalary ?? null : null,
});

export const remote = {
  hire: (e: EmployeeProfile) => post("/hr/employees", employeeBody(e)),
  editEmployee: (e: EmployeeProfile) => put(`/hr/employees/${enc(e.id)}`, employeeBody(e)),
  setStatus: (id: string, status: "ACTIVE" | "INACTIVE") => put(`/hr/employees/${enc(id)}/status`, { status }),
  setShift: (employeeId: string, date: string, shift: ShiftCode | null, branchId: string) => put("/hr/schedule", { employeeId, date, shift, branchId }),
  clockIn: (employeeId: string) => post<{ id: string }>("/hr/attendance/clock-in", { employeeId }),
  clockOut: (employeeId: string) => post("/hr/attendance/clock-out", { employeeId }),
  toggleBreak: (attendanceId: string) => post(`/hr/attendance/${enc(attendanceId)}/breaks`, {}),
  absent: (employeeId: string, date: string, shift: ShiftCode) => post<{ id: string }>("/hr/attendance/absent", { employeeId, date, shift }),
  restore: (a: AttendanceRecord) => put("/hr/attendance/restore", {
    employeeId: a.employeeId, date: a.shiftDate, shift: a.shift, status: a.status, clockIn: a.clockIn || null, clockOut: a.clockOut ?? null,
    lateMinutes: a.lateMinutes, overtimeHours: a.overtimeHours, overtimeMultiplier: a.overtimeMultiplier,
    breaks: a.breaks.map((b) => ({ start: b.start, end: b.end ?? null })),
  }),
  /** branch undefined = the company-wide run */
  approvePayroll: (month: string, branch?: string) => post(`/hr/payroll/${enc(month)}/approve${branch ? `?branch=${enc(branch)}` : ""}`, {}),
  reopenPayroll: (month: string, branch?: string) => post(`/hr/payroll/${enc(month)}/reopen${branch ? `?branch=${enc(branch)}` : ""}`, {}),
  addLog: (l: PerformanceLog) => post("/hr/performance-logs", {
    id: l.id, employeeId: l.employeeId, type: l.type, rating: l.rating ?? null, severity: l.severity, note: l.note, reference: l.reference ?? null,
  }),
  deleteLog: (id: string) => api(`/hr/performance-logs/${enc(id)}`, { method: "DELETE" }),
};
