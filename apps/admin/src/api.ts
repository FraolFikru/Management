/* =========================================================
   Connection to the Eirsha Ops backend.

   VITE_API_URL set   → sign in with a real account; all data comes from
                        the backend and every change is saved there.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type { AuditEntry, Branch, LocalizedText, MenuPrice, ReceiptConfig, RolePermissions, StoreProfile, Transaction, UserAccount } from "./types";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "eirsha.admin.session";
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

const put = <T>(path: string, body: unknown): Promise<T> => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
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
  profile: StoreProfile;
  branches: Branch[];
  users: UserAccount[];
  permissions: RolePermissions[];
  /** Admin matrix flag → backend permission code, e.g. canEditPrices → menu.price_edit */
  flagCodes: Record<string, string>;
  receipt: ReceiptConfig;
  prices: (MenuPrice & { name: LocalizedText })[];
  audit: AuditEntry[];
  transactions: Transaction[];
}

export const loadAll = (): Promise<Bootstrap> => api<Bootstrap>("/admin/bootstrap");

/* ---------- writes (each mirrors one store.ts function) ---------- */

let flagCodes: Record<string, string> = {};
export const setFlagCodes = (m: Record<string, string>): void => { flagCodes = m; };

export const remote = {
  profile: (p: StoreProfile) => put("/admin/store-profile", {
    businessName: p.businessName, branchName: p.branchName, tinNumber: p.tinNumber, vatNumber: p.vatNumber,
    licenseNumber: p.licenseNumber, address: p.address, phone: p.phone, vatRate: p.vatRate,
    isVatEnabled: p.isVatEnabled, currencySymbol: p.currencySymbol,
  }),
  createBranch: (b: Branch) => post("/admin/branches", { id: b.id, name: b.name, code: b.code, address: b.address, phone: b.phone, managerId: b.managerId, isActive: b.isActive }),
  updateBranch: (b: Branch) => put(`/admin/branches/${encodeURIComponent(b.id)}`, { name: b.name, code: b.code, address: b.address, phone: b.phone, managerId: b.managerId, isActive: b.isActive }),
  price: (p: MenuPrice) => put(`/admin/menu-prices/${encodeURIComponent(p.id)}`, { basePrice: p.basePrice, overrides: p.overrides }),
  permission: (role: string, flag: string, granted: boolean) =>
    put(`/admin/permissions/${encodeURIComponent(role)}/${encodeURIComponent(flagCodes[flag] ?? flag)}?granted=${granted}`, {}),
  createUser: (u: UserAccount, password?: string) => post("/admin/users", { ...userBody(u), id: u.id, password: password || null }),
  updateUser: (u: UserAccount, password?: string) => put(`/admin/users/${encodeURIComponent(u.id)}`, { ...userBody(u), password: password || null }),
  receipt: (r: ReceiptConfig) => put("/admin/receipt", r),
  exportLog: (what: string, format: string, rows: number) => post("/admin/exports/log", { what, format, rows }),
};

function userBody(u: UserAccount) {
  return { fullName: u.fullName, username: u.username, role: u.role, assignedBranchId: u.assignedBranchId, phone: u.phone || null, isActive: u.isActive };
}
