/* =========================================================
   Connection to the SEER backend.

   VITE_API_URL set   → sign in with a real account; purchases, waste and
                        expenses are saved and go to the manager and Finance.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type { AuditEntry, CustomExpenseRecord, InventoryItem, PurchaseRecord, Role, WasteRecord } from "./types";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string; initials?: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "seer.sales.session";
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
  /** this account's role in the Sales app; null = it can't use this app */
  role: Role | null;
  purchases: PurchaseRecord[];
  waste: WasteRecord[];
  expenses: CustomExpenseRecord[];
  customInventory: (InventoryItem & { name: string })[];
  audit: AuditEntry[];
}

export const loadAll = (): Promise<Bootstrap> => api<Bootstrap>("/sales/bootstrap");

/* ---------- writes ---------- */

export const remote = {
  item: (i: InventoryItem, name: string) => post("/inventory/items", {
    id: i.id, nameKey: i.nameKey, name, main: i.main, unit: i.unit, unitCost: i.unitCost, aliases: [...i.aliases],
  }),
  purchase: (p: PurchaseRecord) => post("/purchases", {
    id: p.id, itemId: p.itemId, quantity: p.quantity, unit: p.unit, unitCost: p.unitCost, vendor: p.vendor || "Unknown vendor",
    paymentMethod: p.paymentMethod, settlement: "PAID_NOW", note: p.note, timestamp: p.timestamp, clientRef: p.id,
  }),
  waste: (w: WasteRecord) => post("/waste", {
    id: w.id, itemId: w.itemId, quantityLost: w.quantityLost, reason: w.reason, customNotes: w.customNotes ?? null,
    unitCost: w.unitCost, timestamp: w.timestamp, clientRef: w.id,
  }),
  expense: (e: CustomExpenseRecord) => post("/expenses", {
    id: e.id, reason: e.reason, tag: e.tag, amount: e.amount, paymentMethod: e.paymentMethod, note: e.note,
    timestamp: e.timestamp, clientRef: e.id,
  }),
  decideWaste: (id: string, approve: boolean) => post(`/manager/waste/${encodeURIComponent(id)}/decision`, { approve }),
  remove: (path: "purchases" | "waste" | "expenses", id: string) => api(`/${path}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  restore: (path: "purchases" | "waste" | "expenses", id: string) => post(`/${path}/${encodeURIComponent(id)}/restore`, {}),
};
