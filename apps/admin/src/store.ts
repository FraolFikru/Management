/* =========================================================
   State and every write. Each change is checked against the
   permission rules and added to the activity log with the signed-in
   user and branch.
   ========================================================= */

import type {
  AuditEntry, AuditKind, Branch, FieldErrors, MenuPrice, PermissionKey, ReceiptConfig, RolePermissions, StoreProfile, SupportedLanguage, Transaction, UserAccount, UserRole, ViewId,
} from "./types";
import { lockReason, lockedValue } from "./catalog";
import { BRANCHES, MENU_PRICES, PERMISSIONS_SEED, PROFILE, RECEIPT, USERS, generateAudit, generateTransactions, newId } from "./seed";
import { setCurrencySymbol } from "./format";
import { isLive, loadAll, remote, sessionUser, setFlagCodes } from "./api";
import { registerText } from "./i18n";

/* ---------- UI state ---------- */

export type Modal =
  | { kind: "branch"; id: string | null }
  | { kind: "user"; id: string | null }
  | { kind: "price"; id: string }
  | { kind: "bulk" }
  | null;

export interface UiState {
  lang: SupportedLanguage;
  theme: "dark" | "light";
  userId: string;
  view: ViewId;
  /** Global branch toggle: "ALL" or a branch id */
  scope: string;
  modal: Modal;
  errors: FieldErrors;
  userMenu: boolean;
  userFilter: "ALL" | UserRole;
  auditKind: "ALL" | AuditKind;
  auditQuery: string;
}

const PREFS_KEY = "system-admin-v1";
function loadPrefs(): Partial<UiState> {
  try { const raw = localStorage.getItem(PREFS_KEY); return raw ? (JSON.parse(raw) as Partial<UiState>) : {}; } catch { return {}; }
}
const prefs = loadPrefs();

export const state: UiState = {
  lang: prefs.lang === "am" || prefs.lang === "om" ? prefs.lang : "en",
  theme: prefs.theme === "light" ? "light" : "dark",
  userId: USERS.some((u) => u.id === prefs.userId) ? (prefs.userId as string) : "U-001",
  view: "store",
  scope: "ALL",
  modal: null,
  errors: {},
  userMenu: false,
  userFilter: "ALL",
  auditKind: "ALL",
  auditQuery: "",
};

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, theme: state.theme, userId: state.userId })); } catch { /* not persisted */ }
}

/* ---------- data ---------- */

export const db = {
  profile: { ...PROFILE } as StoreProfile,
  branches: BRANCHES.map((b) => ({ ...b })) as Branch[],
  users: USERS.map((u) => ({ ...u })) as UserAccount[],
  permissions: PERMISSIONS_SEED as RolePermissions[],
  receipt: { ...RECEIPT } as ReceiptConfig,
  prices: MENU_PRICES as MenuPrice[],
  audit: generateAudit() as AuditEntry[],
  transactions: generateTransactions() as Transaction[],
  lastBackup: null as null | { at: string; userId: string; what: string },
};
setCurrencySymbol(db.profile.currencySymbol);

/* ---------- backend sync (live mode) ----------
   Writes stay instant: the screen changes first, then the change is sent.
   If the backend refuses it, the change is rolled back and onSyncError
   tells the user why. Undo sends the previous state the same way. */

let syncError: (message: string) => void = () => {};
export function onSyncError(fn: (message: string) => void): void { syncError = fn; }

function push(task: () => Promise<unknown>, rollback: () => void): void {
  if (!isLive) return;
  task().catch((err: unknown) => {
    rollback();
    syncError(err instanceof Error ? err.message : String(err));
  });
}

/** Replace the demo data with the backend's (live mode, after sign-in). */
export async function loadFromBackend(): Promise<void> {
  const b = await loadAll();
  setFlagCodes(b.flagCodes);
  for (const p of b.prices) registerText(`menu.${p.id}`, { en: p.name.en, am: p.name.am || p.name.en, om: p.name.om || p.name.en });
  db.profile = b.profile;
  db.branches = b.branches;
  db.users = b.users;
  db.permissions = b.permissions;
  db.receipt = b.receipt;
  db.prices = b.prices.map(({ name: _name, ...p }) => p);
  db.audit = b.audit;
  db.transactions = b.transactions;
  setCurrencySymbol(db.profile.currencySymbol);
  state.userId = sessionUser()?.id ?? state.userId;
}

export const user = (): UserAccount => db.users.find((u) => u.id === state.userId) ?? db.users[0];
export const userName = (id: string): string => db.users.find((u) => u.id === id)?.fullName ?? id;
export const branchById = (id: string): Branch | undefined => db.branches.find((b) => b.id === id);
export const branchName = (id: string): string => branchById(id)?.name ?? id;
export const permsOf = (role: UserRole): RolePermissions => db.permissions.find((p) => p.role === role) as RolePermissions;
export const can = (key: PermissionKey, u: UserAccount = user()): boolean => u.isActive && permsOf(u.role)[key];
/** Users who can open this module (the "Logged in as" switcher shows everyone, for the demo). */
export const isAdmin = (): boolean => can("canAccessAdmin");

/* ---------- activity log ---------- */

export function log(kind: AuditKind, text: string, vars: AuditEntry["vars"] = {}, branchId = state.scope === "ALL" ? user().assignedBranchId : state.scope): AuditEntry {
  const e: AuditEntry = { id: newId("A"), at: new Date().toISOString(), userId: state.userId, branchId, kind, text, vars };
  db.audit.unshift(e);
  return e;
}
const unlog = (e: AuditEntry): void => { db.audit = db.audit.filter((x) => x !== e); };

/* ---------- store profile ---------- */

export function saveProfile(next: StoreProfile): () => void {
  const before = { ...db.profile };
  db.profile = { ...next };
  setCurrencySymbol(next.currencySymbol);
  const changed = (Object.keys(next) as (keyof StoreProfile)[]).filter((k) => next[k] !== before[k]).length;
  const e = log("SETTINGS", "Updated store profile ({n} fields)", { n: changed });
  const local = (): void => { db.profile = before; setCurrencySymbol(before.currencySymbol); unlog(e); };
  push(() => remote.profile(db.profile), local);
  return () => { local(); push(() => remote.profile(before), () => {}); };
}

/* ---------- branches ---------- */

export function saveBranch(data: Omit<Branch, "id" | "openedOn"> & { id: string | null }): { branch: Branch; undo: () => void } {
  if (data.id) {
    const b = branchById(data.id) as Branch;
    const before = { ...b };
    Object.assign(b, { ...data, id: b.id });
    const e = log("BRANCH", "Edited branch {name}", { name: b.name }, b.id);
    const local = (): void => { Object.assign(b, before); unlog(e); };
    push(() => remote.updateBranch(b), local);
    return { branch: b, undo: () => { local(); push(() => remote.updateBranch(b), () => {}); } };
  }
  const b: Branch = { ...data, id: newId("BR"), openedOn: new Date().toISOString().slice(0, 10) };
  db.branches.push(b);
  const e = log("BRANCH", "Added branch {name}", { name: b.name }, b.id);
  const local = (): void => { db.branches = db.branches.filter((x) => x !== b); if (state.scope === b.id) state.scope = "ALL"; unlog(e); };
  push(() => remote.createBranch(b), local);
  // Live: a saved branch is never deleted (its history must stay) — undo marks it closed instead.
  return { branch: b, undo: () => { if (isLive) { b.isActive = false; push(() => remote.updateBranch(b), () => { b.isActive = true; }); } else local(); } };
}

/* ---------- price book ---------- */

export const priceAt = (p: MenuPrice, branchId: string): number => p.overrides[branchId] ?? p.basePrice;

/** Set a price for one branch, or for every branch (base price; branch overrides cleared). */
export function setPrice(id: string, price: number, scope: string): () => void {
  const p = db.prices.find((x) => x.id === id) as MenuPrice;
  const before: MenuPrice = { ...p, overrides: { ...p.overrides } };
  const from = scope === "ALL" ? p.basePrice : priceAt(p, scope);
  if (scope === "ALL") { p.basePrice = price; p.overrides = {}; } else if (price === p.basePrice) delete p.overrides[scope]; else p.overrides[scope] = price;
  const e = log("PRICE", "Changed {item} price: {from} → {to} ({scope})", { item: `menu.${id}`, from, to: price, scope: scope === "ALL" ? "All branches" : branchName(scope) }, scope === "ALL" ? user().assignedBranchId : scope);
  const local = (): void => { Object.assign(p, before); unlog(e); };
  push(() => remote.price(p), local);
  return () => { local(); push(() => remote.price(p), () => {}); };
}

/** Raise or lower every price in every branch by a percentage, rounded to the nearest 5 birr. */
export function bulkPrice(percent: number, category: "ALL" | MenuPrice["category"]): { count: number; undo: () => void } {
  const before = db.prices.map((p) => ({ ...p, overrides: { ...p.overrides } }));
  const adj = (n: number): number => Math.max(5, Math.round((n * (1 + percent / 100)) / 5) * 5);
  let count = 0;
  for (const p of db.prices) {
    if (category !== "ALL" && p.category !== category) continue;
    p.basePrice = adj(p.basePrice);
    for (const b of Object.keys(p.overrides)) p.overrides[b] = adj(p.overrides[b]);
    count++;
  }
  const e = log("PRICE", "Master price update {p}% on {n} items (all branches)", { p: `${percent > 0 ? "+" : ""}${percent}`, n: count });
  const changed = db.prices.filter((p) => category === "ALL" || p.category === category);
  const local = (): void => { db.prices = before; unlog(e); };
  push(() => Promise.all(changed.map((p) => remote.price(p))), local);
  return { count, undo: () => { local(); push(() => Promise.all(before.filter((p) => category === "ALL" || p.category === category).map((p) => remote.price(p))), () => {}); } };
}

/* ---------- roles & users ---------- */

/** Toggle one permission. Returns null when the rules lock it. */
export function togglePermission(role: UserRole, key: PermissionKey): { value: boolean; undo: () => void } | null {
  if (lockReason(role, key)) return null;
  const p = permsOf(role);
  p[key] = !p[key];
  const e = log("ROLE", "{perm} turned {state} for {role}", { perm: key, state: p[key] ? "on" : "off", role: `role.${role}` });
  const local = (): void => { p[key] = !p[key]; unlog(e); };
  push(() => remote.permission(role, key, p[key]), local);
  return { value: p[key], undo: () => { local(); push(() => remote.permission(role, key, p[key]), () => {}); } };
}

/** Bring every locked cell back to its fixed value (keeps the matrix consistent with the rules). */
export function enforceLocks(): void {
  for (const p of db.permissions) for (const k of Object.keys(p) as (keyof RolePermissions)[]) {
    if (k === "role") continue;
    if (lockReason(p.role, k)) p[k] = lockedValue(p.role);
  }
}
if (!isLive) enforceLocks();

export const activeAdmins = (): UserAccount[] => db.users.filter((u) => u.isActive && u.role === "ADMIN");

let remoteChange: () => void = () => {};
/** Called when the backend's answer changed something on screen (e.g. a new account's staff code). */
export function onRemoteChange(fn: () => void): void { remoteChange = fn; }

/** `password` (live mode): required for a new account, optional on edit (empty = keep the current one).
    `pin`: the 4–6 digit Waiter-app PIN (empty = keep). The backend answers with the account's staff code. */
export function saveUser(data: Omit<UserAccount, "id" | "lastLoginAt"> & { id: string | null }, password = "", pin = ""): { account: UserAccount; undo: () => void } {
  const badge = (u: UserAccount, code?: string): void => { if (code) u.staffCode = code; if (pin) u.hasPin = true; remoteChange(); };
  if (data.id) {
    const u = db.users.find((x) => x.id === data.id) as UserAccount;
    const before = { ...u };
    Object.assign(u, { ...data, id: u.id, lastLoginAt: u.lastLoginAt });
    const e = before.role !== u.role
      ? log("ROLE", "Changed {name}'s role: {from} → {to}", { name: u.fullName, from: `role.${before.role}`, to: `role.${u.role}` }, u.assignedBranchId)
      : log("USER", "Edited account {name}", { name: u.fullName }, u.assignedBranchId);
    const local = (): void => { Object.assign(u, before); unlog(e); };
    push(() => remote.updateUser(u, password, pin).then((r) => badge(u, r.staffCode)), local);
    return { account: u, undo: () => { local(); push(() => remote.updateUser(u), () => {}); } };
  }
  const n = db.users.length + 1;
  const u: UserAccount = { ...data, id: isLive ? newId("U") : `U-${String(n).padStart(3, "0")}` };
  db.users.push(u);
  const e = log("USER", "Created account {name} ({role})", { name: u.fullName, role: `role.${u.role}` }, u.assignedBranchId);
  const local = (): void => { db.users = db.users.filter((x) => x !== u); unlog(e); };
  push(() => remote.createUser(u, password, pin).then((r) => badge(u, r.staff_code)), local);
  // Live: accounts are never deleted (the activity log points at them) — undo deactivates instead.
  return { account: u, undo: () => { if (isLive) { u.isActive = false; push(() => remote.updateUser(u), () => { u.isActive = true; }); } else local(); } };
}

export function setActive(id: string, active: boolean): () => void {
  const u = db.users.find((x) => x.id === id) as UserAccount;
  u.isActive = active;
  const e = log("USER", active ? "Reactivated {name}" : "Deactivated {name}", { name: u.fullName }, u.assignedBranchId);
  const local = (): void => { u.isActive = !active; unlog(e); };
  push(() => remote.updateUser(u), local);
  return () => { local(); push(() => remote.updateUser(u), () => {}); };
}

/* ---------- receipt ---------- */

export function saveReceipt(next: ReceiptConfig): () => void {
  const before = { ...db.receipt };
  db.receipt = { ...next };
  const e = log("SETTINGS", "Updated receipt layout");
  const local = (): void => { db.receipt = before; unlog(e); };
  push(() => remote.receipt(db.receipt), local);
  return () => { local(); push(() => remote.receipt(before), () => {}); };
}

/* ---------- export ---------- */

export function recordExport(what: string, format: string, rows: number): void {
  const e = log("EXPORT", "Exported {what} ({format}, {n} rows)", { what, format, n: rows });
  db.lastBackup = { at: e.at, userId: e.userId, what };
  push(() => remote.exportLog(what, format, rows), () => {});
}

/** Pretend sign-in so the log shows who opened the system. */
export function signIn(): void {
  if (isLive) return;           // the backend logs real sign-ins
  const u = user();
  u.lastLoginAt = new Date().toISOString();
  log("LOGIN", "Signed in", {}, u.assignedBranchId);
}
