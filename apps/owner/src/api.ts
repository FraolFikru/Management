/* =========================================================
   Connection to the SEER backend.

   VITE_API_URL set   → sign in with an owner or admin account; every figure
                        comes from the real books, and budgets are saved.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type { Category, MonthPoint, PaymentMethod, Status } from "./data";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string; initials?: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "seer.owner.session";
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
  /** null = this account can't open the owner dashboard */
  role: string | null;
  user: { name: string; email: string; restaurant: string };
  cashFlow: MonthPoint[];
  daily: { date: string; revenue: number; expenses: number }[];
  weekly: { start: string; revenue: number; expenses: number }[];
  paymentMethods: Record<PaymentMethod, {
    id: PaymentMethod; name: string; balance: number; change: number; account: string; spent: number; limit: number; moneyIn: number;
    activity: { label: string; date: string; amount: number }[];
  }>;
  transactions: { id: string; description: string; category: Category; date: string; amount: number; status: Status }[];
  topDishes: { name: string; sold: number; revenue: number; pct: number }[];
  peakHours: { hour: string; orders: number }[];
  budgets: { category: Category; allocated: number; spent: number; lastMonth: number; fixed?: { committed: number; paidOn: string | null } }[];
  goals: { title: string; current: number; target: number; unit: "ETB" | "%" | "★"; deadline: string | null; lowerIsBetter?: boolean }[];
}

export const loadAll = (): Promise<Bootstrap> => api<Bootstrap>("/owner/bootstrap");

/* ---------- writes ---------- */

/** This month's budget for one spending group. */
export const saveBudget = (month: string, group: Category, allocated: number) =>
  api(`/owner/budget-groups/${encodeURIComponent(month)}`, { method: "PUT", body: JSON.stringify({ group, allocated }) });

/* ---------- System Admin accounts (Owner only) ---------- */

export interface AdminAccount {
  id: string; staff_code: string | null; full_name: string; username: string; home_branch_id: string;
  phone: string | null; is_active: boolean | number; last_login_at: string | null; created_at: string;
}
export interface AdminInput { fullName: string; username: string; branchId: string; phone?: string | null; isActive: boolean; password?: string }

export const listAdmins = () => api<{ admins: AdminAccount[]; branches: { id: string; name: string }[] }>("/owner/admins");
export const createAdmin = (body: AdminInput) => api<AdminAccount>("/owner/admins", { method: "POST", body: JSON.stringify(body) });
export const updateAdmin = (id: string, body: AdminInput) =>
  api<AdminAccount>(`/owner/admins/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
