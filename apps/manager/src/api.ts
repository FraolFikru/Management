/* =========================================================
   Connection to the Eirsha Ops backend.

   VITE_API_URL set   → sign in with a real account; the dashboard shows the
                        branch's real sales, stock and queues, and every
                        approval, rejection and log is saved.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type {
  AuditEntry, CogsPurchase, DispatchRecord, ExpenseRecord, InventoryItem, MenuItem, SaleLine, StaffAccount, UserRole, WasteLog,
} from "./types";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string; initials?: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "eirsha.manager.session";
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
  /** this account's role in the Manager app; null = it can't use this app */
  role: UserRole | null;
  branch: { id: string; name: string };
  staff: (StaffAccount & { inactive?: boolean })[];
  menu: MenuItem[];
  inventory: (InventoryItem & { name: string | null })[];
  /** sale lines come as columns + rows (smaller); see loadAll */
  sales: { cols: (keyof SaleLine)[]; rows: unknown[][] };
  purchases: CogsPurchase[];
  dispatches: DispatchRecord[];
  waste: (WasteLog & { pending?: boolean })[];
  expenses: ExpenseRecord[];
  audit: AuditEntry[];
}

export async function loadAll(): Promise<Omit<Bootstrap, "sales"> & { sales: SaleLine[] }> {
  const b = await api<Bootstrap>("/manager/bootstrap");
  const { cols, rows } = b.sales;
  const sales = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as unknown as SaleLine);
  return { ...b, sales };
}

/* ---------- writes ---------- */

type Undoable = "purchase" | "dispatch_request" | "waste_report";
const enc = encodeURIComponent;

export const remote = {
  reviewPurchase: (id: string, decision: "APPROVE" | "FLAG", reason?: string) =>
    post(`/manager/purchases/${enc(id)}/review`, { decision, reason: reason ?? null }),
  decideDispatch: (id: string, approve: boolean, reason?: string) =>
    post(`/manager/dispatch/${enc(id)}/decision`, { approve, reason: reason ?? null }),
  decideWaste: (id: string, approve: boolean, reason?: string) =>
    post(`/manager/waste/${enc(id)}/decision`, { approve, reason: reason ?? null }),
  /** Undo right after a decision (same manager, within 10 minutes): back to pending, stock reversed. */
  undo: (entity: Undoable, id: string) => post("/manager/undo", { entity, id }),
  /** The manager's own waste log: saved already approved, so stock goes down at once. */
  waste: (w: WasteLog) => post("/waste", {
    id: w.id, itemId: w.itemId, quantityLost: w.quantityLost, reason: w.reason, customNotes: w.customNotes ?? null,
    reportedBy: w.reportedBy, unitCost: w.quantityLost ? w.lossValue / w.quantityLost : null, timestamp: w.timestamp,
    clientRef: w.id, approve: true,
  }),
  /** Undo of the manager's own waste log: reverse it, then remove it. */
  removeWaste: async (id: string) => {
    await post("/manager/undo", { entity: "waste_report", id });
    await api(`/waste/${enc(id)}`, { method: "DELETE" });
  },
  expense: (e: ExpenseRecord) => post("/expenses", {
    id: e.id, reason: e.reason, tag: "OTHER", amount: e.amount, paymentMethod: e.source === "PETTY_CASH" ? "CASH" : e.source,
    pettyCash: e.source === "PETTY_CASH", note: e.note, timestamp: e.timestamp, clientRef: e.id,
  }),
  removeExpense: (id: string) => api(`/expenses/${enc(id)}`, { method: "DELETE" }),
};
