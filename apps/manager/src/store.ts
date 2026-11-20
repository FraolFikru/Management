/* =========================================================
   Application state and data.
   - `state` is UI state (view, filters, open modal …).
   - `db` holds records. Every write goes through a function here
     that stamps the signed-in manager's staff ID and time and adds
     an audit entry, so nothing changes without a name on it.
   - Stock levels move only through: purchase approval (+),
     dispatch approval (−) and waste logs (−).
   ========================================================= */

import type {
  AuditAction, AuditEntry, COGSCategory, CogsPurchase, DispatchRecord, ExpenseRecord, FieldErrors, InventoryItem, MenuCategory,
  PaymentMethod, PaymentSummary, PeriodId, RestockRequest, ReviewStatus, Shift, StaffAccount, SupportedLanguage, ViewId, WasteLog, WasteReason,
} from "./types";
import { DASHBOARD_ROLES, MENU, STAFF } from "./catalog";
import { registerText, tkText } from "./i18n";
import { isLive, loadAll, remote, sessionUser, signOut as apiSignOut } from "./api";
import { generateSeed, newId } from "./seed";
import { addDays, localDay, round2, today } from "./format";

/* ---------- UI state ---------- */

export type Modal =
  | { kind: "waste" }
  | { kind: "reject"; id: string }
  | { kind: "flag"; id: string }
  | { kind: "restock" }
  | { kind: "minimums" }
  | null;

export interface UiState {
  lang: SupportedLanguage;
  theme: "dark" | "light";
  userId: string;
  view: ViewId;
  period: PeriodId;
  shift: Shift | "ALL";
  salesSort: { key: "name" | "category" | "units" | "price" | "revenue"; dir: 1 | -1 };
  salesCat: MenuCategory | "ALL";
  salesQuery: string;
  /** decision-history filter on the Dispatch page */
  dispatchTab: "ALL" | "APPROVED" | "REJECTED";
  cogsCat: COGSCategory | "ALL";
  cogsStatus: ReviewStatus | "ALL";
  wasteReason: WasteReason | "ALL";
  auditUser: string;
  auditAction: AuditAction | "ALL";
  auditLimit: number;
  modal: Modal;
  errors: FieldErrors;
  userMenu: boolean;
}

const PREFS_KEY = "branch-manager-dashboard-v1";

function loadPrefs(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}

const prefs = loadPrefs();

export const state: UiState = {
  lang: prefs.lang === "am" || prefs.lang === "om" ? prefs.lang : "en",
  theme: prefs.theme === "light" ? "light" : "dark",
  userId: STAFF.some((s) => s.userId === prefs.userId && DASHBOARD_ROLES.includes(s.role)) ? (prefs.userId as string) : "BM-001",
  view: "overview",
  period: "today",
  shift: "ALL",
  salesSort: { key: "revenue", dir: -1 },
  salesCat: "ALL",
  salesQuery: "",
  dispatchTab: "ALL",
  cogsCat: "ALL",
  cogsStatus: "ALL",
  wasteReason: "ALL",
  auditUser: "ALL",
  auditAction: "ALL",
  auditLimit: 40,
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
  inventory: seed.inventory,
  sales: seed.sales,
  purchases: seed.purchases,
  dispatches: seed.dispatches,
  waste: seed.waste,
  expenses: seed.expenses,
  audit: seed.audit,
  /** restock requests sent to the Purchases team (live: from the backend; demo: only this browser) */
  restock: [] as RestockRequest[],
};

/* ---------- session ---------- */

/** Live mode: the signed-in manager (set once the backend data has loaded). */
let liveUser: StaffAccount | null = null;
export const signedIn = (): boolean => !isLive || liveUser !== null;

export const user = (): StaffAccount => (isLive && liveUser) || STAFF.find((s) => s.userId === state.userId) || STAFF[0];

/* ---------- backend sync (live mode) ----------
   The screen updates at once; the change is then sent. If the backend
   refuses it, the change is rolled back and onSyncError says why. */

let syncError: (message: string) => void = () => {};
export function onSyncError(fn: (message: string) => void): void { syncError = fn; }

let inFlight = 0;
/** A save is still on its way to the server (auto-refresh waits for it). */
export const syncing = (): boolean => inFlight > 0;

function push(task: () => Promise<unknown>, rollback: () => void): void {
  if (!isLive) return;
  inFlight++;
  task().catch((err: unknown) => {
    rollback();
    syncError(err instanceof Error ? err.message : String(err));
  }).finally(() => { inFlight--; });
}

/** Put an object back exactly as it was (fields added since are removed). */
function reset<T extends object>(obj: T, before: T): void {
  for (const k of Object.keys(obj)) if (!(k in before)) delete (obj as Record<string, unknown>)[k];
  Object.assign(obj, before);
}

const unlog = (e: AuditEntry): void => { db.audit = db.audit.filter((x) => x !== e); };

function nameFor(key: string, name: string): void {
  if (!tkText(key)) registerText(key, { en: name, am: name, om: name });
}

/** Replace the demo data with the branch's real data (after a live sign-in). Throws "no-access" if this account can't use the app. */
export async function loadFromBackend(): Promise<void> {
  const b = await loadAll().catch((err: unknown) => {
    throw (err as { status?: number }).status === 403 ? new Error("no-access") : err;
  });
  const u = sessionUser();
  if (!b.role || !u) throw new Error("no-access");
  registerText("branch.name", { en: b.branch.name, am: b.branch.name, om: b.branch.name });
  STAFF.splice(0, STAFF.length, ...b.staff);
  MENU.splice(0, MENU.length, ...b.menu.map((m) => { nameFor(m.nameKey, m.id); return m; }));
  for (const i of b.inventory) nameFor(i.nameKey, i.name ?? i.id);
  db.inventory = b.inventory.map(({ name: _n, ...i }) => ({ ...i, groupKey: `main.${i.main}`, aliases: [] }));
  db.sales = b.sales;
  db.purchases = b.purchases;
  db.dispatches = b.dispatches;
  db.waste = b.waste;
  db.expenses = b.expenses;
  db.audit = b.audit.sort((x, y) => (x.timestamp < y.timestamp ? 1 : -1));
  db.restock = b.restock ?? [];
  const me = b.staff.find((s) => s.userId === u.id);
  liveUser = { userId: u.id, name: u.name, role: b.role, branchId: b.branch.id, initials: me?.initials ?? u.name.slice(0, 2).toUpperCase() };
  state.userId = u.id;
}

export function signOut(): void {
  void apiSignOut();
  liveUser = null;
}
export const staffName = (id: string): string => STAFF.find((s) => s.userId === id)?.name ?? id;

export function switchUser(id: string): void {
  const next = STAFF.find((s) => s.userId === id);
  if (!next || !DASHBOARD_ROLES.includes(next.role) || id === state.userId) return;
  state.userId = id;
  log("SWITCH_USER", { text: next.name });
  savePrefs();
}

export function log(action: AuditAction, detail: Omit<AuditEntry, "id" | "action" | "userId" | "timestamp"> = {}): AuditEntry {
  const e: AuditEntry = { id: newId("aud"), action, userId: state.userId, timestamp: new Date().toISOString(), ...detail };
  db.audit.unshift(e);
  return e;
}

/* ---------- lookups ---------- */

export const item = (id: string): InventoryItem | undefined => db.inventory.find((i) => i.id === id);
/* ---------- low-stock detection ---------- */

export type StockLevel = "OUT" | "CRITICAL" | "LOW" | "OK";

/** The rule: an item needs restocking when currentQuantity <= reorderPoint. */
export const isLowStock = (i: InventoryItem): boolean => i.currentQuantity <= i.reorderPoint;

/** OUT = nothing left · CRITICAL = at or below half the reorder point · LOW = at or below the reorder point. */
export function stockLevel(i: InventoryItem): StockLevel {
  if (i.currentQuantity <= 0) return "OUT";
  if (i.currentQuantity <= i.reorderPoint / 2) return "CRITICAL";
  if (isLowStock(i)) return "LOW";
  return "OK";
}

/** Recomputed from live quantities every time it is called, so approvals and waste logs update it at once. Most urgent first. */
export const lowStock = (): InventoryItem[] =>
  db.inventory.filter(isLowStock).sort((a, b) => a.currentQuantity / Math.max(a.reorderPoint, 1) - b.currentQuantity / Math.max(b.reorderPoint, 1));

/** Suggested order: bring the item back to twice its reorder point. */
export const suggestedOrder = (i: InventoryItem): number => Math.max(1, Math.ceil(i.reorderPoint * 2 - i.currentQuantity));

/* ---------- periods ---------- */

export function rangeFor(p: PeriodId, offset = 0): [string, string] {
  const n = p === "today" ? 1 : p === "7d" ? 7 : 30;
  const end = addDays(today(), -n * offset);
  return [addDays(end, -(n - 1)), end];
}

export const inRange = (iso: string, [from, to]: [string, string]): boolean => {
  const d = localDay(iso);
  return d >= from && d <= to;
};
export const inPeriod = (iso: string, p: PeriodId = state.period): boolean => inRange(iso, rangeFor(p));

/** Same span one period back; for "today" it stops at the current time of day so the comparison is fair. */
function previousFilter(p: PeriodId): (iso: string) => boolean {
  const range = rangeFor(p, 1);
  if (p !== "today") return (iso) => inRange(iso, range);
  const now = new Date();
  const cutoff = now.getHours() * 60 + now.getMinutes();
  return (iso) => {
    if (!inRange(iso, range)) return false;
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes() <= cutoff;
  };
}

/* ---------- totals ---------- */

export interface BranchTotals {
  sales: number;
  tickets: number;
  cogs: number;
  waste: number;
  expenses: number;
}

function totalsWhere(ok: (iso: string) => boolean): BranchTotals {
  let sales = 0;
  const tickets = new Set<string>();
  for (const s of db.sales) if (ok(s.timestamp)) { sales += s.total; tickets.add(s.ticketNo); }
  let cogs = 0;
  for (const p of db.purchases) if (p.status !== "FLAGGED" && ok(p.timestamp)) cogs += p.totalCost;
  let waste = 0;
  for (const w of db.waste) if (!w.pending && ok(w.timestamp)) waste += w.lossValue;
  let expenses = 0;
  for (const e of db.expenses) if (ok(e.timestamp)) expenses += e.amount;
  return { sales, tickets: tickets.size, cogs, waste, expenses };
}

export const periodTotals = (p: PeriodId = state.period): { cur: BranchTotals; prev: BranchTotals } => ({
  cur: totalsWhere((iso) => inPeriod(iso, p)),
  prev: totalsWhere(previousFilter(p)),
});

export function paymentSummary(p: PeriodId, shift: Shift | "ALL"): PaymentSummary {
  const by: Record<PaymentMethod, number> = { CASH: 0, TELEBIRR: 0, CBE_BIRR: 0 };
  for (const s of db.sales) if (inPeriod(s.timestamp, p) && (shift === "ALL" || s.shift === shift)) by[s.paymentMethod] += s.total;
  return { cash: by.CASH, telebirr: by.TELEBIRR, cbeBirr: by.CBE_BIRR, total: by.CASH + by.TELEBIRR + by.CBE_BIRR };
}

export const pendingDispatches = (): DispatchRecord[] =>
  db.dispatches.filter((d) => d.status === "PENDING").sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

/* ---------- writes: dispatches ---------- */

export type DispatchResult = { ok: true; before: number; after: number; purchases?: number } | { ok: false; reason: "stock" | "missing" };

/** A purchase's quantity in the item's own unit (g → kg, ml → liters); other units are taken as they are. */
function inItemUnit(p: CogsPurchase, it: InventoryItem): number {
  if (p.unit === it.unit) return p.quantity;
  const f: Record<string, number> = { g: 0.001, kg: 1, ml: 0.001, liters: 1 };
  return f[p.unit] && f[it.unit] ? p.quantity * (f[p.unit] / f[it.unit]) : p.quantity;
}

/** Purchases of this item still waiting for review. Approving a dispatch of the item approves them too. */
export const waitingPurchases = (itemId: string): CogsPurchase[] =>
  db.purchases.filter((p) => p.itemId === itemId && p.status === "PENDING");

/** Stock that arrives when these purchases are approved. */
export function incomingFor(itemId: string): number {
  const it = item(itemId);
  return it ? round2(waitingPurchases(itemId).reduce((s, p) => s + inItemUnit(p, it), 0)) : 0;
}

/** Approving moves stock out to the destination, after approving the purchases of the item still waiting
    (the stock arrives, then leaves: nothing stays pending). Blocked when even that isn't enough. */
export function approveDispatch(id: string): DispatchResult {
  const d = db.dispatches.find((x) => x.id === id && x.status === "PENDING");
  const it = d ? item(d.itemId) : undefined;
  if (!d || !it) return { ok: false, reason: "missing" };
  const waiting = waitingPurchases(d.itemId);
  const incoming = incomingFor(d.itemId);
  if (it.currentQuantity + incoming < d.quantity) return { ok: false, reason: "stock" };
  const before = it.currentQuantity;
  const was = { ...d };
  const wasP = waiting.map((p) => ({ ...p }));
  const now = new Date().toISOString();
  for (const p of waiting) { p.status = "APPROVED"; p.reviewedBy = state.userId; p.reviewedAt = now; }
  it.currentQuantity = round2(it.currentQuantity + incoming - d.quantity);
  d.status = "APPROVED";
  d.approvedBy = state.userId;
  d.decidedAt = now;
  const e = log("APPROVE_DISPATCH", { itemKey: it.nameKey, quantity: d.quantity, unit: d.unit, destination: d.destination });
  push(() => remote.decideDispatch(id, true), () => {
    reset(d, was);
    waiting.forEach((p, i) => reset(p, wasP[i] as CogsPurchase));
    it.currentQuantity = before;
    unlog(e);
  });
  return { ok: true, before, after: it.currentQuantity, purchases: waiting.length };
}

export function rejectDispatch(id: string, reason: string): boolean {
  const d = db.dispatches.find((x) => x.id === id && x.status === "PENDING");
  if (!d) return false;
  const was = { ...d };
  d.status = "REJECTED";
  d.rejectionReason = reason;
  d.approvedBy = state.userId;
  d.decidedAt = new Date().toISOString();
  const e = log("REJECT_DISPATCH", { itemKey: d.itemName, quantity: d.quantity, unit: d.unit, destination: d.destination, text: reason });
  push(() => remote.decideDispatch(id, false, reason), () => { reset(d, was); unlog(e); });
  return true;
}

/** Undo puts the request back in the queue (and returns stock if it had been approved). */
export function reopenDispatch(id: string): void {
  const d = db.dispatches.find((x) => x.id === id);
  if (!d || d.status === "PENDING") return;
  const it = item(d.itemId);
  const was = { ...d }, qty = it?.currentQuantity;
  if (d.status === "APPROVED" && it) it.currentQuantity = round2(it.currentQuantity + d.quantity);
  d.status = "PENDING";
  delete d.rejectionReason;
  delete d.approvedBy;
  delete d.decidedAt;
  const e = log("UNDO", { itemKey: d.itemName, quantity: d.quantity, unit: d.unit, destination: d.destination, text: "dispatch decision" });
  push(() => remote.undo("dispatch_request", id), () => { reset(d, was); if (it && qty !== undefined) it.currentQuantity = qty; unlog(e); });
}

/* ---------- writes: COGS review ---------- */

/** Approving a purchase confirms delivery: stock goes up. */
export function approvePurchase(id: string): boolean {
  const p = db.purchases.find((x) => x.id === id && x.status !== "APPROVED");
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return false;
  const was = { ...p }, qty = it.currentQuantity;
  p.status = "APPROVED";
  p.reviewedBy = state.userId;
  p.reviewedAt = new Date().toISOString();
  delete p.flagReason;
  it.currentQuantity = round2(it.currentQuantity + p.quantity);
  const e = log("APPROVE_PURCHASE", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, amount: p.totalCost });
  push(() => remote.reviewPurchase(id, "APPROVE"), () => { reset(p, was); it.currentQuantity = qty; unlog(e); });
  return true;
}

export function flagPurchase(id: string, reason: string): boolean {
  const p = db.purchases.find((x) => x.id === id && x.status === "PENDING");
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return false;
  const was = { ...p };
  p.status = "FLAGGED";
  p.flagReason = reason;
  p.reviewedBy = state.userId;
  p.reviewedAt = new Date().toISOString();
  const e = log("FLAG_PURCHASE", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, amount: p.totalCost, text: reason });
  push(() => remote.reviewPurchase(id, "FLAG", reason), () => { reset(p, was); unlog(e); });
  return true;
}

export function reopenPurchase(id: string, wasApproved: boolean): void {
  const p = db.purchases.find((x) => x.id === id);
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return;
  const was = { ...p }, qty = it.currentQuantity;
  if (wasApproved) it.currentQuantity = round2(it.currentQuantity - p.quantity);
  p.status = "PENDING";
  delete p.reviewedBy;
  delete p.reviewedAt;
  delete p.flagReason;
  const e = log("UNDO", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, text: "purchase review" });
  push(() => remote.undo("purchase", id), () => { reset(p, was); it.currentQuantity = qty; unlog(e); });
}

/* ---------- writes: waste & expenses ---------- */

export function logWaste(w: Omit<WasteLog, "id" | "loggedBy" | "timestamp">): WasteLog {
  const rec: WasteLog = { ...w, id: newId("wst"), loggedBy: state.userId, timestamp: new Date().toISOString() };
  db.waste.unshift(rec);
  const it = item(w.itemId), qty = it?.currentQuantity;
  if (it) it.currentQuantity = Math.max(0, round2(it.currentQuantity - w.quantityLost));
  const e = log("LOG_WASTE", { itemKey: w.itemName, quantity: w.quantityLost, unit: w.unit, amount: w.lossValue, text: w.customNotes });
  push(() => remote.waste(rec), () => {
    db.waste = db.waste.filter((x) => x !== rec);
    if (it && qty !== undefined) it.currentQuantity = qty;
    unlog(e);
  });
  return rec;
}

export function removeWaste(id: string): void {
  const rec = db.waste.find((w) => w.id === id);
  if (!rec) return;
  db.waste = db.waste.filter((w) => w !== rec);
  const it = item(rec.itemId), qty = it?.currentQuantity;
  if (it) it.currentQuantity = round2(it.currentQuantity + rec.quantityLost);
  const e = log("UNDO", { itemKey: rec.itemName, quantity: rec.quantityLost, unit: rec.unit, text: "waste log" });
  push(() => remote.removeWaste(id), () => { db.waste.unshift(rec); if (it && qty !== undefined) it.currentQuantity = qty; unlog(e); });
}

/** A waste report the inventory clerk sent in: approve (stock goes down) or reject (it is dropped). */
export function decideWasteReport(id: string, approve: boolean, reason?: string): WasteLog | null {
  const rec = db.waste.find((w) => w.id === id && w.pending);
  if (!rec) return null;
  const it = item(rec.itemId), qty = it?.currentQuantity;
  if (approve) {
    delete rec.pending;
    if (it) it.currentQuantity = Math.max(0, round2(it.currentQuantity - rec.quantityLost));
  } else {
    db.waste = db.waste.filter((w) => w !== rec);
  }
  const e = log("LOG_WASTE", { itemKey: rec.itemName, quantity: rec.quantityLost, unit: rec.unit, amount: rec.lossValue,
    text: approve ? "approved" : `rejected${reason ? `: ${reason}` : ""}` });
  push(() => remote.decideWaste(id, approve, reason), () => {
    rec.pending = true;
    if (!db.waste.includes(rec)) db.waste.unshift(rec);
    if (it && qty !== undefined) it.currentQuantity = qty;
    unlog(e);
  });
  return rec;
}

/** Undo of a decision on a clerk's waste report: back to waiting. */
export function reopenWasteReport(rec: WasteLog, wasApproved: boolean): void {
  const it = item(rec.itemId), qty = it?.currentQuantity;
  rec.pending = true;
  if (!db.waste.includes(rec)) db.waste.unshift(rec);
  if (wasApproved && it) it.currentQuantity = round2(it.currentQuantity + rec.quantityLost);
  const e = log("UNDO", { itemKey: rec.itemName, quantity: rec.quantityLost, unit: rec.unit, text: "waste log" });
  push(() => remote.undo("waste_report", rec.id), () => {
    if (wasApproved) delete rec.pending; else db.waste = db.waste.filter((w) => w !== rec);
    if (it && qty !== undefined) it.currentQuantity = qty;
    unlog(e);
  });
}

export function logExpense(e: Omit<ExpenseRecord, "id" | "loggedBy" | "timestamp">): ExpenseRecord {
  const rec: ExpenseRecord = { ...e, id: newId("exp"), loggedBy: state.userId, timestamp: new Date().toISOString() };
  db.expenses.unshift(rec);
  const a = log("LOG_EXPENSE", { text: e.reason, amount: e.amount });
  push(() => remote.expense(rec), () => { db.expenses = db.expenses.filter((x) => x !== rec); unlog(a); });
  return rec;
}

export function removeExpense(id: string): void {
  const rec = db.expenses.find((e) => e.id === id);
  if (!rec) return;
  db.expenses = db.expenses.filter((e) => e !== rec);
  const a = log("UNDO", { text: rec.reason, amount: rec.amount });
  push(() => remote.removeExpense(id), () => { db.expenses.unshift(rec); unlog(a); });
}

/* ---------- restock requests: the manager asks, the Purchases team buys ---------- */

export const RESTOCK_WAITING: readonly RestockRequest["status"][] = ["OPEN", "ORDERED"];
/** The request still waiting for this item, if any. */
export const openRestockFor = (itemId: string): RestockRequest | undefined =>
  db.restock.find((r) => r.itemId === itemId && RESTOCK_WAITING.includes(r.status));

/** Send items to the Purchases team. One request per item; an item already waiting gets its quantity updated. */
export function sendRestock(lines: { itemId: string; quantity: number }[], note: string): Promise<boolean> {
  const before = db.restock.map((r) => ({ ...r }));
  const now = new Date().toISOString();
  const me = user();
  const temp = new Set<string>();
  for (const l of lines) {
    const it = item(l.itemId);
    if (!it) continue;
    const prev = openRestockFor(l.itemId);
    if (prev) { prev.quantity = l.quantity; if (note) prev.note = note; continue; }
    const id = newId("rst");
    temp.add(id);
    db.restock.unshift({ id, itemId: it.id, nameKey: it.nameKey, quantity: l.quantity, unit: it.unit, note, status: "OPEN",
      bought: 0, requestedBy: me.userId, requestedByName: me.name, requestedAt: now, reason: "" });
  }
  if (!isLive) return Promise.resolve(true);
  return remote.sendRestock(lines, note).then((saved) => {
    const ids = new Set(saved.map((r) => r.id));
    db.restock = [...saved, ...db.restock.filter((x) => !temp.has(x.id) && !ids.has(x.id))];
    return true;
  }, (err: unknown) => {
    db.restock = before;
    syncError(err instanceof Error ? err.message : String(err));
    return false;
  });
}

function patchRestock(id: string, change: Partial<RestockRequest>, call: () => Promise<RestockRequest>): void {
  const r = db.restock.find((x) => x.id === id);
  if (!r) return;
  const before = { ...r };
  Object.assign(r, change);
  push(() => call().then((saved) => Object.assign(r, saved)), () => Object.assign(r, before));
}

export const cancelRestock = (id: string): void =>
  patchRestock(id, { status: "CANCELLED", doneAt: new Date().toISOString() }, () => remote.cancelRestock(id));

export const reopenRestock = (id: string): void =>
  patchRestock(id, { status: "OPEN", reason: "", handledBy: null, handledByName: "", doneAt: null }, () => remote.reopenRestock(id));

/** Live mode: fetch the latest statuses (Purchases may have bought, ordered or declined). True when anything changed. */
export async function refreshRestock(): Promise<boolean> {
  if (!isLive || !liveUser) return false;
  const [next, disp] = await Promise.all([remote.listRestock(), remote.listDispatches()]);
  const sig = (l: RestockRequest[]): string => l.map((r) => `${r.id}:${r.status}:${r.bought}:${r.quantity}`).join("|");
  const dsig = (l: DispatchRecord[]): string => l.map((d) => `${d.id}:${d.status}`).sort().join("|");
  let changed = false;
  if (sig(next) !== sig(db.restock)) { db.restock = next; changed = true; }
  // new dispatch requests from the Purchases team (or ones they cancelled)
  if (dsig(disp) !== dsig(db.dispatches)) { db.dispatches = disp; changed = true; }
  return changed;
}

/* ---------- restock minimums ---------- */

/** Change the restock minimum of these items (instantly here; sent to the backend in live mode). */
export function setMinimums(changes: { itemId: string; minimum: number }[]): void {
  const before = changes.map((c) => ({ itemId: c.itemId, minimum: item(c.itemId)?.reorderPoint ?? 0 }));
  for (const c of changes) { const it = item(c.itemId); if (it) it.reorderPoint = c.minimum; }
  push(() => remote.setMinimums(changes), () => {
    for (const b of before) { const it = item(b.itemId); if (it) it.reorderPoint = b.minimum; }
  });
}
