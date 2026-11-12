/* ─────────────────────────────────────────────────────────────
   Connection to the SEER backend.

   Set VITE_API_URL (e.g. https://seer-api.onrender.com) to go live:
   sign-in, menu and prices come from the backend, and every charged order
   is saved, sent to the kitchen display, and counted in Finance.
   Leave it empty to run the built-in demo (nothing is saved).
   ───────────────────────────────────────────────────────────── */

import type { CategoryId, MenuItem } from './data';

const BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '');
export const isLive = BASE.length > 0;

export type PayMethod = 'CASH' | 'TELEBIRR' | 'CBE_BIRR';

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  branchId: string;
  staffCode: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const KEY = 'seer.cashier.session';

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let session: Session | null = load();

function save(s: Session | null): void {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: keep it in memory only */
  }
}

export const currentUser = (): SessionUser | null => session?.user ?? null;

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (session) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
    headers.set('X-Branch-Id', session.user.branchId);
  }
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function refresh(): Promise<boolean> {
  if (!session) return false;
  const res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) });
  if (!res.ok) {
    save(null);
    return false;
  }
  const s = (await res.json()) as Session;
  save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
  return true;
}

/** JSON request; refreshes the 15-minute access token once on 401. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && (await refresh())) res = await raw(path, init);
  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error ?? (typeof body.detail === 'string' ? body.detail : msg);
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export async function signIn(username: string, password: string): Promise<SessionUser> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  if (!res.ok) throw new ApiError(res.status === 401 ? 'wrong' : `Server error (${res.status})`, res.status);
  const s = (await res.json()) as Session;
  save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
  return s.user;
}

export async function signOut(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* already expired: nothing to revoke */
  }
  save(null);
}

// ───────── menu ─────────

interface BranchMenuRow {
  menu_item_id: string;
  name_key: string;
  category_code: string;
  price: number | string;
}

/** Backend menu categories → the cashier's four tabs. */
const TAB: Record<string, CategoryId> = {
  MAINS: 'mains', FASTING: 'mains', BREAKFAST: 'breakfast',
  HOT_DRINKS: 'drinks', COLD_DRINKS: 'drinks', BAR: 'drinks', SIDES: 'sides',
};

export async function loadMenu(): Promise<MenuItem[]> {
  const [rows, en, am] = await Promise.all([
    api<BranchMenuRow[]>('/pos/menu'),
    api<Record<string, string>>('/ref/i18n/en'),
    api<Record<string, string>>('/ref/i18n/am'),
  ]);
  return rows.map((r) => ({
    id: r.menu_item_id,
    category: TAB[r.category_code] ?? 'mains',
    name: { en: en[r.name_key] ?? r.menu_item_id, am: am[r.name_key] ?? en[r.name_key] ?? r.menu_item_id },
    price: Number(r.price),                                 // VAT-inclusive, branch price
  }));
}

// ───────── orders ─────────

export interface SaleInput {
  lines: { itemId: string; qty: number }[];
  orderType: 'dine-in' | 'takeaway';
  table: number;
  method: PayMethod;
  reference?: string;
  tendered?: number;
}

export interface SaleResult {
  orderNumber: string;
  receiptNo: string | null;
  total: number;
}

interface OrderOut {
  id: string;
  order_number: string;
  total_gross: number | string;
  receipt_no: string | null;
}

/** An order created on the backend but not finished yet (payment failed or not sent). */
export interface PendingOrder {
  id: string;
  orderNumber: string;
  total: number;
  signature: string;   // what was in the cart when it was created
  paid: boolean;
}

export const cartSignature = (sale: SaleInput): string =>
  JSON.stringify([sale.lines.map((l) => [l.itemId, l.qty]), sale.orderType, sale.orderType === 'dine-in' ? sale.table : null]);

/** Step 1: create the order (not sent to the kitchen yet). */
export async function createOrder(sale: SaleInput): Promise<PendingOrder> {
  const order = await api<OrderOut>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      orderType: sale.orderType === 'dine-in' ? 'DINE_IN' : 'TAKEOUT',
      tableNumber: sale.orderType === 'dine-in' ? String(sale.table) : null,
      lines: sale.lines.map((l) => ({ menu_item_id: l.itemId, quantity: l.qty })),
      sendNow: false,
      clientRef: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    }),
  });
  return { id: order.id, orderNumber: order.order_number, total: Number(order.total_gross), signature: cartSignature(sale), paid: false };
}

/** Step 2: take the payment for the backend's total. */
export async function payOrder(order: PendingOrder, sale: SaleInput): Promise<string | null> {
  const paid = await api<OrderOut>(`/orders/${encodeURIComponent(order.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify([{ method: sale.method, amount: order.total, reference: sale.reference || null, tendered: sale.tendered ?? null }]),
  });
  return paid.receipt_no;
}

/** Step 3: only a paid order goes to the kitchen display. */
export async function sendToKitchen(order: PendingOrder): Promise<void> {
  await api(`/orders/${encodeURIComponent(order.id)}/send`, { method: 'POST' });
}

/** Drop an order that was never paid (customer left, or the cart changed). */
export async function cancelOrder(order: PendingOrder): Promise<void> {
  await api(`/orders/${encodeURIComponent(order.id)}/cancel`, { method: 'POST' });
}
