/* =========================================================
   State and data access. Every write goes through `record*`
   helpers that stamp the signed-in user and append an audit entry,
   so accountability cannot be skipped by a screen.
   Records live in memory; swap `db` for an API-backed repository
   when connecting a backend.
   ========================================================= */

import type {
  AuditAction, AuditEntity, AuditEntry, CustomExpenseRecord, FieldErrors, InventoryItem, PeriodId, PeriodTotals,
  DispatchRequest, MainCategory, PurchaseRecord, RestockRequest, Role, StaffAccount, SupportedLanguage, ThemeMode, ViewId, WasteRecord,
} from "./types";
import { BASE_INVENTORY, CAN_APPROVE_WASTE, CAN_DELETE, STAFF, VIEW_ACCESS } from "./catalog";
import { generateSeed, newId } from "./seed";
import { addDays, localDay, today } from "./format";
import { isLanguage, registerText } from "./i18n";
import { isLive, loadAll, remote, sessionUser, signOut as apiSignOut } from "./api";

const loadRestock = (): Promise<RestockRequest[]> => remote.listRestock();

/* ---------- preferences & session (persisted per browser) ---------- */

interface Prefs {
  lang: SupportedLanguage;
  theme: ThemeMode;
  userId: string | null;
}

const PREFS_KEY = "seer-ledger-v3";

function loadPrefs(): Prefs {
  const fallback: Prefs = { lang: "en", theme: "dark", userId: "u-hanna" };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      lang: isLanguage(p.lang) ? p.lang : "en",
      theme: p.theme === "light" ? "light" : "dark",
      userId: STAFF.some((s) => s.userId === p.userId) ? (p.userId as string) : null,
    };
  } catch {
    return fallback;
  }
}

/* ---------- state ---------- */

export interface UiState {
  lang: SupportedLanguage;
  theme: ThemeMode;
  userId: string | null;
  view: ViewId;
  period: PeriodId;
  errors: FieldErrors;
  /** purchase history filter on the Purchases screen */
  boughtFilter: MainCategory | "ALL";
  boughtLimit: number;
  auditUser: string;
  auditEntity: AuditEntity | "ALL";
  auditLimit: number;
  wasteFilter: "ALL" | "PENDING";
  signInFor: string | null;
}

const prefs = loadPrefs();

export const state: UiState = {
  ...prefs,
  view: "dashboard",
  period: "today",
  errors: {},
  boughtFilter: "ALL",
  boughtLimit: 20,
  auditUser: "ALL",
  auditEntity: "ALL",
  auditLimit: 25,
  wasteFilter: "ALL",
  signInFor: null,
};

export function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, theme: state.theme, userId: state.userId }));
  } catch {
    /* storage unavailable */
  }
}

const seed = generateSeed();

export const db = {
  purchases: seed.purchases,
  waste: seed.waste,
  expenses: seed.expenses,
  audit: seed.audit,
  customInventory: [] as InventoryItem[],
  /** what the manager asked the Purchases team to buy */
  restock: seed.restock as RestockRequest[],
  /** dispatch requests this branch sent to its manager */
  dispatches: [] as DispatchRequest[],
};

/** This branch: who approves dispatches and where stock can go (demo values until the backend loads). */
export const branchInfo = {
  name: "Bole Branch",
  managers: ["Hanna Tesfaye"] as string[],
  places: ["KITCHEN_LINE", "BAR", "TAKEAWAY_COUNTER", "CATERING", "EVENT_HALL"] as string[],
  branches: [{ id: "BR-PIA", name: "Piassa Branch" }] as { id: string; name: string }[],
  /** store-room quantity per item; empty in the demo (unknown) */
  stock: {} as Record<string, number>,
  canDispatch: true,
};

/* ---------- session ---------- */

/** Live mode: the signed-in account, as the Purchases app knows it (set after the backend data loads). */
let liveUser: StaffAccount | null = null;

export const currentUser = (): StaffAccount | null =>
  isLive ? liveUser : STAFF.find((s) => s.userId === state.userId) ?? null;

/* ---------- backend sync (live mode) ----------
   Saves stay instant: the screen updates first, then the record is sent.
   If the backend refuses it, the change is rolled back and onSyncError
   says why. Undo and delete are sent the same way. */

let syncError: (message: string) => void = () => {};
export function onSyncError(fn: (message: string) => void): void { syncError = fn; }

function push(task: () => Promise<unknown>, rollback: () => void): Promise<void> {
  if (!isLive) return Promise.resolve();
  return task().then(() => undefined, (err: unknown) => {
    rollback();
    syncError(err instanceof Error ? err.message : String(err));
  });
}

/** Items created on this screen, saved before any purchase that uses them. */
const itemSaved = new Map<string, Promise<void>>();

/** Replace the demo data with the backend's (after a live sign-in). Throws "no-access" if this account can't use the app. */
export async function loadFromBackend(): Promise<void> {
  const b = await loadAll().catch((err: unknown) => {
    throw (err as { status?: number }).status === 403 ? new Error("no-access") : err;
  });
  const u = sessionUser();
  if (!b.role || !u) throw new Error("no-access");
  for (const c of b.customInventory) registerText(c.nameKey, { en: c.name, am: c.name, om: c.name });
  db.purchases = b.purchases;
  db.waste = b.waste;
  db.expenses = b.expenses;
  db.audit = b.audit;
  db.customInventory = b.customInventory.map(({ name: _n, ...i }) => i);
  db.restock = b.restock ?? [];
  db.dispatches = b.dispatches ?? [];
  if (b.branch) {
    branchInfo.name = b.branch.name;
    branchInfo.managers = b.managers ?? [];
    branchInfo.places = b.places ?? [];
    branchInfo.branches = b.branches ?? [];
    branchInfo.stock = b.stock ?? {};
    branchInfo.canDispatch = b.canDispatch !== false;
  }
  liveUser = { userId: u.id, name: u.name, role: b.role, initials: u.initials ?? u.name.split(" ").map((w) => w[0]).join("").slice(0, 2), pin: "" };
  state.userId = u.id;
}

/** Save a stock item the clerk just created (live mode). */
export function recordItem(item: InventoryItem, name: string): void {
  itemSaved.set(item.id, push(() => remote.item(item, name), () => {
    db.customInventory = db.customInventory.filter((i) => i !== item);
  }));
}

/** The signed-in user; screens are only rendered when someone is signed in. */
export function user(): StaffAccount {
  const u = currentUser();
  if (!u) throw new Error("No user signed in");
  return u;
}

export const canView = (view: ViewId, role: Role = user().role): boolean =>
  VIEW_ACCESS[view].includes(role) && (view !== "dispatch" || branchInfo.canDispatch);
export const canApproveWaste = (): boolean => CAN_APPROVE_WASTE.includes(user().role);
export const canDelete = (): boolean => CAN_DELETE.includes(user().role);

export function signIn(userId: string, pin: string): boolean {
  const account = STAFF.find((s) => s.userId === userId);
  if (!account || account.pin !== pin) return false;
  state.userId = userId;
  savePrefs();
  log("SIGN_IN", "SESSION", userId, "Signed in", {});
  return true;
}

export function signOut(): void {
  if (isLive) {
    void apiSignOut();
    liveUser = null;
    state.userId = null;
    return;
  }
  if (state.userId) log("SIGN_OUT", "SESSION", state.userId, "Signed out", {});
  state.userId = null;
  savePrefs();
}

/* ---------- audit ---------- */

export function log(action: AuditAction, entity: AuditEntity, entityId: string, summary: string, detail: AuditEntry["detail"]): AuditEntry {
  const u = user();
  const entry: AuditEntry = {
    id: newId("aud"), action, entity, entityId, summary, detail,
    userId: u.userId, userName: u.name, role: u.role, timestamp: new Date().toISOString(),
  };
  db.audit.unshift(entry);
  return entry;
}

/** Who is stamping this record. */
export const stampUser = (): { loggedBy: string; userId: string } => ({ loggedBy: user().name, userId: user().userId });

/* ---------- writes ---------- */

export function recordPurchase(p: PurchaseRecord): void {
  // the purchase fills the manager's request it was bought for, or else the oldest one waiting for the same item
  const req = (p.restockRequestId && db.restock.find((r) => r.id === p.restockRequestId && r.itemId === p.itemId && RESTOCK_WAITING.includes(r.status)))
    || openRestockFor(p.itemId);
  const reqBefore = req ? { ...req } : null;
  if (req) {
    p.restockRequestId = req.id;
    if (p.unit === req.unit) req.bought += p.quantity;
    if (req.bought >= req.quantity) { req.status = "DONE"; req.doneAt = new Date().toISOString(); }
  }
  db.purchases.push(p);
  const e = log("CREATE", "PURCHASE", p.id, `Purchase ${p.itemId}`, { name: p.itemName, amount: p.totalCost, quantity: p.quantity, unit: p.unit });
  const ready = itemSaved.get(p.itemId) ?? Promise.resolve();
  void ready.then(() => push(() => remote.purchase(p).then(() => refreshRestock()), () => {
    db.purchases = db.purchases.filter((x) => x !== p);
    if (req && reqBefore) Object.assign(req, reqBefore);
    unlog(e);
  }));
}

/* ---------- restock requests from the manager ---------- */

export const RESTOCK_WAITING: readonly RestockRequest["status"][] = ["OPEN", "ORDERED"];
export const waitingRestock = (): RestockRequest[] =>
  db.restock.filter((r) => RESTOCK_WAITING.includes(r.status)).sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
export const openRestockFor = (itemId: string): RestockRequest | undefined =>
  waitingRestock().find((r) => r.itemId === itemId);

function restockChange(id: string, change: Partial<RestockRequest>, action: "ORDERED" | "DECLINE", reason?: string): RestockRequest | undefined {
  const r = db.restock.find((x) => x.id === id);
  if (!r) return undefined;
  const before = { ...r };
  Object.assign(r, change, { handledBy: user().userId, handledByName: user().name, handledAt: new Date().toISOString() });
  void push(() => remote.restock(id, action, reason).then((saved) => Object.assign(r, saved)), () => Object.assign(r, before));
  return r;
}

export const markRestockOrdered = (id: string): RestockRequest | undefined => restockChange(id, { status: "ORDERED" }, "ORDERED");
export const declineRestock = (id: string, reason: string): RestockRequest | undefined =>
  restockChange(id, { status: "DECLINED", reason, doneAt: new Date().toISOString() }, "DECLINE", reason);

/** Live mode: fetch the latest restock requests and dispatch decisions from the manager. True when anything changed. */
export async function refreshRestock(): Promise<boolean> {
  if (!isLive || !liveUser) return false;
  const [next, disp] = await Promise.all([loadRestock(), branchInfo.canDispatch ? remote.myDispatches() : Promise.resolve(db.dispatches)]);
  const sig = (l: RestockRequest[]): string => l.map((r) => `${r.id}:${r.status}:${r.bought}:${r.quantity}:${r.note}`).join("|");
  const dsig = (l: DispatchRequest[]): string => l.map((d) => `${d.id}:${d.status}`).join("|");
  const pendingLocal = db.dispatches.filter((d) => d.id.startsWith("local-"));
  if (sig(next) === sig(db.restock) && dsig(disp) === dsig(db.dispatches.filter((d) => !d.id.startsWith("local-")))) return false;
  db.restock = next;
  db.dispatches = [...pendingLocal, ...disp];
  return true;
}

/* ---------- dispatch: ask the branch manager to release stock ---------- */

export interface DispatchDraft { itemId: string; quantity: number; destination?: string; toBranchId?: string; note: string }

/** Shows at once as "Waiting for the manager"; replaced by the saved record when the backend answers. */
export function sendDispatch(d: DispatchDraft): DispatchRequest | undefined {
  const it = inventoryItem(d.itemId);
  if (!it) return undefined;
  const id = newId("local");
  const to = d.toBranchId ? branchInfo.branches.find((b) => b.id === d.toBranchId) : undefined;
  const rec: DispatchRequest = {
    id, itemId: it.id, itemName: it.nameKey, quantity: d.quantity, unit: it.unit, destination: d.destination ?? "BRANCH",
    ...(to ? { toBranchId: to.id, toBranchName: to.name } : {}), ...(d.note ? { note: d.note } : {}),
    requestedBy: user().userId, requestedByName: user().name, timestamp: new Date().toISOString(), status: "PENDING",
  };
  db.dispatches.unshift(rec);
  const e = log("CREATE", "DISPATCH", id, `Dispatch ${it.id}`, { name: it.nameKey, quantity: d.quantity, unit: it.unit });
  void push(async () => {
    const saved = (await remote.dispatch({ ...d, clientRef: id })) as { id: string };
    rec.id = saved.id;
  }, () => { db.dispatches = db.dispatches.filter((x) => x !== rec); unlog(e); });
  return rec;
}

export function cancelDispatch(id: string): DispatchRequest | undefined {
  const i = db.dispatches.findIndex((x) => x.id === id);
  if (i < 0) return undefined;
  const [rec] = db.dispatches.splice(i, 1);
  void push(() => remote.cancelDispatch(id), () => { db.dispatches.splice(i, 0, rec); });
  return rec;
}

export function recordWaste(w: WasteRecord): void {
  db.waste.push(w);
  const e = log("CREATE", "WASTE", w.id, `Waste ${w.itemId}`, { name: w.itemName, amount: w.lossValue, quantity: w.quantityLost, unit: w.unit });
  void push(() => remote.waste(w), () => { db.waste = db.waste.filter((x) => x !== w); unlog(e); });
}

export function recordExpense(x: CustomExpenseRecord): void {
  db.expenses.push(x);
  const e = log("CREATE", "EXPENSE", x.id, x.reason, { name: x.reason, amount: x.amount });
  void push(() => remote.expense(x), () => { db.expenses = db.expenses.filter((r) => r !== x); unlog(e); });
}

const unlog = (e: AuditEntry): void => { db.audit = db.audit.filter((x) => x !== e); };
const PATH = { PURCHASE: "purchases", WASTE: "waste", EXPENSE: "expenses" } as const;

export function decideWaste(id: string, approve: boolean): WasteRecord | undefined {
  const w = db.waste.find((x) => x.id === id);
  if (!w || !canApproveWaste()) return undefined;
  const before = { approval: w.approval, approvedBy: w.approvedBy, approvedAt: w.approvedAt };
  w.approval = approve ? "APPROVED" : "REJECTED";
  w.approvedBy = user().name;
  w.approvedAt = new Date().toISOString();
  const e = log(approve ? "APPROVE" : "REJECT", "WASTE", w.id, `Waste ${w.itemId}`, { name: w.itemName, amount: w.lossValue });
  void push(() => remote.decideWaste(w.id, approve), () => { Object.assign(w, before); unlog(e); });
  return w;
}

type AnyRecord =
  | { entity: "PURCHASE"; row: PurchaseRecord }
  | { entity: "WASTE"; row: WasteRecord }
  | { entity: "EXPENSE"; row: CustomExpenseRecord };

/** Remove a record (manager action or immediate undo). Returns what was removed so it can be restored. */
export function removeRecord(entity: AuditEntity, id: string): AnyRecord | null {
  let removed: AnyRecord | null = null;
  if (entity === "PURCHASE") {
    const row = db.purchases.find((p) => p.id === id);
    if (row) { db.purchases = db.purchases.filter((p) => p !== row); removed = { entity, row }; }
  } else if (entity === "WASTE") {
    const row = db.waste.find((w) => w.id === id);
    if (row) { db.waste = db.waste.filter((w) => w !== row); removed = { entity, row }; }
  } else if (entity === "EXPENSE") {
    const row = db.expenses.find((e) => e.id === id);
    if (row) { db.expenses = db.expenses.filter((e) => e !== row); removed = { entity, row }; }
  }
  if (removed) {
    const r = removed;
    const e = log("DELETE", entity, id, `Deleted ${entity.toLowerCase()}`, removedDetail(r));
    void push(() => remote.remove(PATH[r.entity], id), () => { putBack(r); unlog(e); });
  }
  return removed;
}

function putBack(r: AnyRecord): void {
  if (r.entity === "PURCHASE") db.purchases.push(r.row);
  else if (r.entity === "WASTE") db.waste.push(r.row);
  else db.expenses.push(r.row);
}

function takeOut(r: AnyRecord): void {
  if (r.entity === "PURCHASE") db.purchases = db.purchases.filter((x) => x !== r.row);
  else if (r.entity === "WASTE") db.waste = db.waste.filter((x) => x !== r.row);
  else db.expenses = db.expenses.filter((x) => x !== r.row);
}

export function restoreRecord(r: AnyRecord): void {
  putBack(r);
  const id = r.row.id;
  const e = log("RESTORE", r.entity, id, `Restored ${r.entity.toLowerCase()}`, removedDetail(r));
  void push(() => remote.restore(PATH[r.entity], id), () => { takeOut(r); unlog(e); });
}

function removedDetail(r: AnyRecord): AuditEntry["detail"] {
  if (r.entity === "PURCHASE") return { name: r.row.itemName, amount: r.row.totalCost };
  if (r.entity === "WASTE") return { name: r.row.itemName, amount: r.row.lossValue };
  return { name: r.row.reason, amount: r.row.amount };
}


/* ---------- catalog ---------- */

export const inventory = (): InventoryItem[] => [...BASE_INVENTORY, ...db.customInventory];
export const inventoryItem = (id: string): InventoryItem | undefined => inventory().find((i) => i.id === id);

export function lastCost(itemId: string): number | undefined {
  let best: PurchaseRecord | undefined;
  for (const p of db.purchases) if (p.itemId === itemId && (!best || p.timestamp > best.timestamp)) best = p;
  return best?.unitCost;
}

/** Suppliers used before (for suggestions). "Unknown vendor" is what a blank supplier is saved as, so it's left out. */
export const vendors = (): string[] =>
  [...new Set(db.purchases.map((p) => p.vendor).filter((v) => v && v !== "Unknown vendor"))].sort();
export const pastReasons = (): string[] => [...new Set(db.expenses.map((e) => e.reason))];

/* ---------- periods & totals ---------- */

export function rangeFor(period: PeriodId): { start: string; end: string; prevStart: string; prevEnd: string; days: number } {
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const end = today();
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  return { start, end, prevStart: addDays(prevEnd, -(days - 1)), prevEnd, days };
}

const inRange = (iso: string, a: string, b: string): boolean => {
  const d = localDay(iso);
  return d >= a && d <= b;
};

/** Same-length comparison window: for "today" compare with the same time yesterday so a half day isn't judged against a full one. */
export function totals(start: string, end: string, cutoffMs?: number): PeriodTotals {
  const ok = (iso: string): boolean => inRange(iso, start, end) && (cutoffMs === undefined || new Date(iso).getTime() <= cutoffMs);
  let purchases = 0, entries = 0;
  for (const p of db.purchases) if (ok(p.timestamp)) { purchases += p.totalCost; entries++; }
  let waste = 0, wastePending = 0;
  for (const w of db.waste) {
    if (!ok(w.timestamp) || w.approval === "REJECTED") continue;
    if (w.approval === "APPROVED") waste += w.lossValue;
    else wastePending += w.lossValue;
  }
  let expenses = 0;
  for (const e of db.expenses) if (ok(e.timestamp)) expenses += e.amount;
  return {
    purchases, entries, waste, wastePending, expenses, spent: purchases + expenses,
  };
}

export function periodTotals(): { cur: PeriodTotals; prev: PeriodTotals } {
  const r = rangeFor(state.period);
  if (state.period === "today") {
    const yesterdaySameTime = Date.now() - 86_400_000;
    return { cur: totals(r.start, r.end), prev: totals(r.prevStart, r.prevEnd, yesterdaySameTime) };
  }
  return { cur: totals(r.start, r.end), prev: totals(r.prevStart, r.prevEnd) };
}

export const inPeriod = (iso: string): boolean => {
  const r = rangeFor(state.period);
  return inRange(iso, r.start, r.end);
};
