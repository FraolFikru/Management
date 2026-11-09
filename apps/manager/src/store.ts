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
  AuditAction, AuditEntry, COGSCategory, DispatchRecord, ExpenseRecord, FieldErrors, InventoryItem, MenuCategory,
  PaymentMethod, PaymentSummary, PeriodId, ReviewStatus, Shift, StaffAccount, SupportedLanguage, ViewId, WasteLog, WasteReason,
} from "./types";
import { DASHBOARD_ROLES, STAFF } from "./catalog";
import { generateSeed, newId } from "./seed";
import { addDays, localDay, round2, today } from "./format";

/* ---------- UI state ---------- */

export type Modal =
  | { kind: "waste" }
  | { kind: "reject"; id: string }
  | { kind: "flag"; id: string }
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
};

/* ---------- session ---------- */

export const user = (): StaffAccount => STAFF.find((s) => s.userId === state.userId) ?? STAFF[0];
export const staffName = (id: string): string => STAFF.find((s) => s.userId === id)?.name ?? id;

export function switchUser(id: string): void {
  const next = STAFF.find((s) => s.userId === id);
  if (!next || !DASHBOARD_ROLES.includes(next.role) || id === state.userId) return;
  state.userId = id;
  log("SWITCH_USER", { text: next.name });
  savePrefs();
}

export function log(action: AuditAction, detail: Omit<AuditEntry, "id" | "action" | "userId" | "timestamp"> = {}): void {
  db.audit.unshift({ id: newId("aud"), action, userId: state.userId, timestamp: new Date().toISOString(), ...detail });
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
  for (const w of db.waste) if (ok(w.timestamp)) waste += w.lossValue;
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

export type DispatchResult = { ok: true; before: number; after: number } | { ok: false; reason: "stock" | "missing" };

/** Approving moves stock out to the destination. Blocked when stock is short. */
export function approveDispatch(id: string): DispatchResult {
  const d = db.dispatches.find((x) => x.id === id && x.status === "PENDING");
  const it = d ? item(d.itemId) : undefined;
  if (!d || !it) return { ok: false, reason: "missing" };
  if (it.currentQuantity < d.quantity) return { ok: false, reason: "stock" };
  const before = it.currentQuantity;
  it.currentQuantity = round2(it.currentQuantity - d.quantity);
  d.status = "APPROVED";
  d.approvedBy = state.userId;
  d.decidedAt = new Date().toISOString();
  log("APPROVE_DISPATCH", { itemKey: it.nameKey, quantity: d.quantity, unit: d.unit, destination: d.destination });
  return { ok: true, before, after: it.currentQuantity };
}

export function rejectDispatch(id: string, reason: string): boolean {
  const d = db.dispatches.find((x) => x.id === id && x.status === "PENDING");
  if (!d) return false;
  d.status = "REJECTED";
  d.rejectionReason = reason;
  d.approvedBy = state.userId;
  d.decidedAt = new Date().toISOString();
  log("REJECT_DISPATCH", { itemKey: d.itemName, quantity: d.quantity, unit: d.unit, destination: d.destination, text: reason });
  return true;
}

/** Undo puts the request back in the queue (and returns stock if it had been approved). */
export function reopenDispatch(id: string): void {
  const d = db.dispatches.find((x) => x.id === id);
  if (!d || d.status === "PENDING") return;
  const it = item(d.itemId);
  if (d.status === "APPROVED" && it) it.currentQuantity = round2(it.currentQuantity + d.quantity);
  d.status = "PENDING";
  delete d.rejectionReason;
  delete d.approvedBy;
  delete d.decidedAt;
  log("UNDO", { itemKey: d.itemName, quantity: d.quantity, unit: d.unit, destination: d.destination, text: "dispatch decision" });
}

/* ---------- writes: COGS review ---------- */

/** Approving a purchase confirms delivery: stock goes up. */
export function approvePurchase(id: string): boolean {
  const p = db.purchases.find((x) => x.id === id && x.status !== "APPROVED");
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return false;
  p.status = "APPROVED";
  p.reviewedBy = state.userId;
  p.reviewedAt = new Date().toISOString();
  delete p.flagReason;
  it.currentQuantity = round2(it.currentQuantity + p.quantity);
  log("APPROVE_PURCHASE", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, amount: p.totalCost });
  return true;
}

export function flagPurchase(id: string, reason: string): boolean {
  const p = db.purchases.find((x) => x.id === id && x.status === "PENDING");
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return false;
  p.status = "FLAGGED";
  p.flagReason = reason;
  p.reviewedBy = state.userId;
  p.reviewedAt = new Date().toISOString();
  log("FLAG_PURCHASE", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, amount: p.totalCost, text: reason });
  return true;
}

export function reopenPurchase(id: string, wasApproved: boolean): void {
  const p = db.purchases.find((x) => x.id === id);
  const it = p ? item(p.itemId) : undefined;
  if (!p || !it) return;
  if (wasApproved) it.currentQuantity = round2(it.currentQuantity - p.quantity);
  p.status = "PENDING";
  delete p.reviewedBy;
  delete p.reviewedAt;
  delete p.flagReason;
  log("UNDO", { itemKey: it.nameKey, quantity: p.quantity, unit: p.unit, text: "purchase review" });
}

/* ---------- writes: waste & expenses ---------- */

export function logWaste(w: Omit<WasteLog, "id" | "loggedBy" | "timestamp">): WasteLog {
  const rec: WasteLog = { ...w, id: newId("wst"), loggedBy: state.userId, timestamp: new Date().toISOString() };
  db.waste.unshift(rec);
  const it = item(w.itemId);
  if (it) it.currentQuantity = Math.max(0, round2(it.currentQuantity - w.quantityLost));
  log("LOG_WASTE", { itemKey: w.itemName, quantity: w.quantityLost, unit: w.unit, amount: w.lossValue, text: w.customNotes });
  return rec;
}

export function removeWaste(id: string): void {
  const rec = db.waste.find((w) => w.id === id);
  if (!rec) return;
  db.waste = db.waste.filter((w) => w !== rec);
  const it = item(rec.itemId);
  if (it) it.currentQuantity = round2(it.currentQuantity + rec.quantityLost);
  log("UNDO", { itemKey: rec.itemName, quantity: rec.quantityLost, unit: rec.unit, text: "waste log" });
}

export function logExpense(e: Omit<ExpenseRecord, "id" | "loggedBy" | "timestamp">): ExpenseRecord {
  const rec: ExpenseRecord = { ...e, id: newId("exp"), loggedBy: state.userId, timestamp: new Date().toISOString() };
  db.expenses.unshift(rec);
  log("LOG_EXPENSE", { text: e.reason, amount: e.amount });
  return rec;
}

export function removeExpense(id: string): void {
  const rec = db.expenses.find((e) => e.id === id);
  if (!rec) return;
  db.expenses = db.expenses.filter((e) => e !== rec);
  log("UNDO", { text: rec.reason, amount: rec.amount });
}
