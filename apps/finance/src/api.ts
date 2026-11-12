/* =========================================================
   Connection to the SEER backend.

   VITE_API_URL set   → sign in with a real account; the books show the real
                        sales, bills, payroll and money, and every bill,
                        payment, filing and reconciliation is saved.
   VITE_API_URL empty → the built-in demo (nothing is saved).
   ========================================================= */

import type { AccountId, Bill, BillPayment, DailySales, Movement, PayrollCost, Reconciliation, TaxFiling, Vendor } from "./types";

const BASE = ((import.meta.env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isLive = BASE.length > 0;

interface SessionUser { id: string; name: string; role: string; branchId: string; initials?: string }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const KEY = "seer.finance.session";
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
  /** null = this account can't use the Finance app */
  role: "FINANCE" | null;
  start: string;
  users: { id: string; name: string; role: string }[];
  vendors: (Vendor & { internal?: boolean })[];
  sales: DailySales[];
  bills: Bill[];
  payroll: PayrollCost[];
  filings: TaxFiling[];
  recon: Reconciliation[];
  /** the branch whose till is reconciled on the Cash page */
  reconBranch: string;
  reconBranchName: string;
  /** bank deposit already booked for each reconciled day (date → ETB) */
  deposits: Record<string, number>;
  opening: Record<AccountId, number>;
  movements: Movement[];
}

export const loadAll = (): Promise<Bootstrap> => api<Bootstrap>("/finance/bootstrap");

/* ---------- writes ---------- */

const enc = encodeURIComponent;
const put = <T>(path: string, body: unknown): Promise<T> => api<T>(path, { method: "PUT", body: JSON.stringify(body) });

export interface PaidResult { paymentId: string; amount: string; withheld: string; netPaid: string }

export const remote = {
  addBill: (b: Bill) => post("/finance/bills", {
    id: b.id, vendorId: b.vendorId, billNo: b.billNo, category: b.category, issueDate: b.issueDate, dueDate: b.dueDate,
    description: b.description, subtotal: b.subtotal, vat: b.vat, hasReceipt: b.hasReceipt,
  }),
  voidBill: (id: string) => api(`/finance/bills/${enc(id)}`, { method: "DELETE" }),
  pay: (billId: string, p: BillPayment) => post<PaidResult>(`/finance/bills/${enc(billId)}/payments`, {
    id: p.id, amount: p.amount, method: p.method, date: p.date, reference: p.reference || null,
  }),
  unpay: (paymentId: string) => api(`/finance/bill-payments/${enc(paymentId)}`, { method: "DELETE" }),
  filing: (month: string, kind: "VAT" | "WHT", filed: boolean, reference?: string, amount?: number) =>
    put(`/finance/tax-filings/${enc(month)}/${kind}`, { filed, reference: reference ?? null, amount: amount ?? null }),
  recon: (branch: string, r: Reconciliation) => put(`/finance/reconciliations/${enc(branch)}/${enc(r.date)}`, {
    cashCounted: r.cashCounted, bankDeposit: r.bankDeposit, bankConfirmed: r.bankConfirmed,
    telebirrReceived: r.telebirrReceived, cbeBirrReceived: r.cbeBirrReceived, note: r.note,
  }),
};
