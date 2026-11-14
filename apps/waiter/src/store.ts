/* =========================================================
   What the app knows, and everything a waiter can do.

   The screen changes at once; the change is then queued for the
   server (see api.ts). New items are picked on the phone first
   (drafts) and only reach the check when the waiter taps Send or
   Hold — so taking an order never waits for the network.
   ========================================================= */

import * as api from "./api";
import { t } from "./i18n";
import type { Draft, Floor, FloorTable, Lang, Menu, Order, OrderLine, PayMethod } from "./types";

export type Filter = "mine" | "all";
export type View = "tables" | "waiting";
export type Sheet =
  | { kind: "guests"; tableId: string; orderId?: string; guests: number }
  | { kind: "item"; draftId: string }
  | { kind: "send" }
  | { kind: "void"; lineId: string; reason: string; other: string }
  | { kind: "transfer"; orderId: string }
  | { kind: "move"; orderId: string }
  | { kind: "note"; orderId: string }
  | { kind: "pay"; orderId: string; method: PayMethod; amount: string; reference: string; error: string }
  | { kind: "table"; tableId: string }
  | { kind: "orderMenu" }
  | { kind: "profile" }
  | { kind: "setup"; count: string; name: string; error: string; busy: boolean };

interface Prefs { lang: Lang; dark: boolean; filter: Filter; view?: View }
const prefs = api.cache.read<Prefs>("seer.waiter.prefs") ?? { lang: "en", dark: false, filter: "all" };

export const state = {
  lang: prefs.lang,
  dark: prefs.dark,
  filter: (prefs.filter === "mine" ? "mine" : "all") as Filter,
  /** bottom tab: the floor plan, or the list of open tables that need something */
  view: (prefs.view === "waiting" ? "waiting" : "tables") as View,
  /** "New order": the floor plan waits for a free table to be chosen */
  picking: false,
  /** the free table chosen on the floor plan, opened with the button under it */
  picked: null as string | null,
  /** room / area of the floor plan ("" = all) */
  area: "",
  floor: api.cache.read<Floor>("seer.waiter.floor"),
  floorError: "",
  loading: false,
  menu: api.cache.read<Menu>("seer.waiter.menu"),
  branches: [] as { id: string; name: string }[],
  /** floor, or one table's check */
  orderId: null as string | null,
  tab: "menu" as "menu" | "check",
  category: "ALL",
  fastingOnly: false,
  menuSearch: "",
  course: 1,
  sheet: null as Sheet | null,
  toast: null as { text: string; bad: boolean } | null,
  live: false,
  offline: false,
  pending: api.pendingCount(),
};

export const orders: Record<string, Order> = {};
/** picked, not yet saved */
export const drafts: Record<string, Draft[]> = api.cache.read("seer.waiter.drafts") ?? {};
/** saved by the waiter, still on their way to the server */
export const sending: Record<string, Draft[]> = api.cache.read("seer.waiter.sending") ?? {};

let render: () => void = () => {};
export function onChange(fn: () => void): void { render = fn; }
const persist = (): void => { api.cache.write("seer.waiter.drafts", drafts); api.cache.write("seer.waiter.sending", sending); };
export function savePrefs(): void { api.cache.write("seer.waiter.prefs", { lang: state.lang, dark: state.dark, filter: state.filter, view: state.view }); }

const newId = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const me = () => state.floor?.me ?? null;
export const order = (): Order | null => (state.orderId ? orders[state.orderId] ?? null : null);
export const tableOf = (id: string): FloorTable | undefined => state.floor?.tables.find((x) => x.id === id);
export const canEdit = (o: Order | null): boolean => !!o && !!me() && (o.waiterId === me()!.id || me()!.canManage);
export const isOpen = (o: Order | null): boolean => !!o && (o.orderStatus === "OPEN" || o.orderStatus === "SENT");
export const item = (id: string) => state.menu?.items.find((i) => i.id === id);

/** The rooms of this branch (tables without one are in the main room). */
export const areas = (): string[] => [...new Set((state.floor?.tables ?? []).map((x) => x.area?.trim() || t("Main room")))];
const inScope = (tb: FloorTable): boolean =>
  (state.filter === "all" || tb.order?.waiterId === me()?.id) && (!state.area || (tb.area?.trim() || t("Main room")) === state.area);
/** Tables on the floor plan: "New order" shows only the free ones. */
export const visibleTables = (): FloorTable[] =>
  (state.floor?.tables ?? []).filter((tb) => (state.picking ? tb.status === "FREE" : inScope(tb)));
/** Open tables, the ones that need the waiter first. */
export const waitingTables = (): FloorTable[] => {
  const rank: Record<string, number> = { READY: 0, BILL: 1, IN_KITCHEN: 2, SEATED: 3, SERVED: 4 };
  return (state.floor?.tables ?? []).filter((tb) => tb.order && tb.status !== "FREE" && (state.filter === "all" || tb.order.waiterId === me()?.id))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.order!.openedAt < b.order!.openedAt ? -1 : 1));
};

let toastTimer: number | undefined;
export function toast(text: string, bad = false): void {
  state.toast = { text, bad };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { state.toast = null; render(); }, bad ? 6000 : 2600);
  render();
}

/* ---------- loading ---------- */

let floorBusy = false, floorAgain = false;
export async function loadFloor(): Promise<void> {
  if (floorBusy) { floorAgain = true; return; }       // something changed while we were asking: ask once more afterwards
  floorBusy = true;
  try {
    const before = state.floor;
    const f = await api.getFloor();
    // tell the waiter when the kitchen has food for one of their tables
    for (const tb of f.tables) {
      const was = before?.tables.find((x) => x.id === tb.id);
      if (tb.status === "READY" && was && was.status !== "READY" && tb.order?.waiterId === f.me.id) {
        toast(t("Food is ready for {table}", { table: tb.name }));
        try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
      }
    }
    state.floor = f;
    state.floorError = "";
    state.offline = false;
    api.cache.write("seer.waiter.floor", f);
  } catch (err) {
    if (err instanceof api.Offline) state.offline = true;
    else if (err instanceof api.ApiError && err.status === 403) state.floorError = "no-access";
    else if (!(err instanceof api.ApiError && err.status === 401)) state.floorError = err instanceof Error ? err.message : String(err);
  }
  floorBusy = false;
  state.loading = false;
  render();
  if (floorAgain) { floorAgain = false; void loadFloor(); }
}

export async function loadMenu(): Promise<void> {
  try {
    state.menu = await api.getMenu();
    api.cache.write("seer.waiter.menu", state.menu);
    render();
  } catch { /* keep the menu saved on the phone */ }
}

export async function loadOrder(id: string): Promise<void> {
  if (api.pendingFor(id)) return;                 // our own changes are still on their way: don't overwrite them
  try {
    const o = await api.getOrder(id);
    if (!api.pendingFor(id)) orders[id] = o;
    render();
  } catch { /* offline: keep what we have */ }
}

let refreshTimer: number | undefined;
/** A table changed somewhere: refetch soon (several events in a row become one request). */
export function refreshSoon(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void loadFloor();
    if (state.orderId) void loadOrder(state.orderId);
  }, 250);
}

/* ---------- the queue's answers ---------- */

api.onQueue({
  done(a, result) {
    const o = result as Order;
    if (o && typeof o === "object" && "lines" in o) {
      const ids = new Set(o.lines.map((l) => l.id));
      if (sending[o.id]) {
        sending[o.id] = sending[o.id].filter((d) => !ids.has(d.id));
        if (!sending[o.id].length) delete sending[o.id];
        persist();
      }
      if (!api.pendingFor(o.id)) orders[o.id] = o;
      if (o.orderStatus === "PAID" && a.path.endsWith("/payments")) {
        toast(t("{table} is paid. The table is free.", { table: o.tableName }));
        if (state.orderId === o.id) { state.orderId = null; state.sheet = null; }
      } else if (a.path.endsWith("/payments")) {
        toast(t("Part paid — {due} still due.", { due: `ETB ${o.due.toLocaleString("en-US")}` }));
      } else if (o.orderStatus === "VOIDED" && state.orderId === o.id) {
        state.orderId = null;
      }
    }
    refreshSoon();
    render();
  },
  refused(a, message) {
    // put items that never reached the check back among the new ones, so nothing the guest ordered is lost
    if (sending[a.orderId]) {
      drafts[a.orderId] = [...(drafts[a.orderId] ?? []), ...sending[a.orderId]];
      delete sending[a.orderId];
      persist();
    }
    delete orders[a.orderId];
    toast(t("Not done: {reason}", { reason: `${a.label} — ${message}` }), true);
    void loadFloor();
    if (state.orderId === a.orderId) void api.getOrder(a.orderId).then((o) => { orders[o.id] = o; render(); }, () => { state.orderId = null; render(); });
  },
  changed(pending, offline) {
    state.pending = pending;
    if (offline) state.offline = true;
    else if (!pending) state.offline = false;
    render();
  },
});

const send = (orderId: string, path: string, body: unknown, label: string, method: "POST" | "PUT" = "POST"): void =>
  api.enqueue({ orderId, method, path, body, label });
const op = (o: Order): string => `/floor/orders/${encodeURIComponent(o.id)}`;

/* ---------- tables ---------- */

export function openTable(tableId: string, guests: number): void {
  const tb = tableOf(tableId), m = me();
  if (!tb || !m) return;
  const id = newId("ord"), now = new Date().toISOString();
  orders[id] = { id, orderNumber: "…", tableId, tableName: tb.name, guests, waiterId: m.id, waiterName: m.name, openedAt: now, note: "",
    billRequestedAt: null, orderStatus: "OPEN", status: "SEATED", total: 0, vat: 0, paid: 0, due: 0, receiptNo: null, lines: [], payments: [] };
  tb.status = "SEATED";
  tb.order = { id, orderNumber: "…", guests, openedAt: now, total: 0, due: 0, waiterId: m.id, waiterName: m.name, billRequestedAt: null, ready: 0, held: 0 };
  send(id, `/floor/tables/${encodeURIComponent(tableId)}/open`, { id, guests }, t("Open {table}", { table: tb.name }));
  state.orderId = id; state.tab = "menu"; state.sheet = null; state.course = 1; state.menuSearch = ""; state.category = "ALL";
  render();
}

export function showOrder(id: string): void {
  state.orderId = id;
  state.tab = (drafts[id]?.length ?? 0) > 0 || !orders[id] || orders[id].lines.length === 0 ? "menu" : "check";
  state.sheet = null; state.course = 1; state.menuSearch = ""; state.category = "ALL";
  render();
  void loadOrder(id);
}

/* ---------- picking items ---------- */

export const draftsOf = (id: string | null): Draft[] => (id ? drafts[id] ?? [] : []);
export function draftTotal(d: Draft): number {
  const it = item(d.itemId);
  const mods = d.mods.reduce((s, m) => s + (state.menu?.modifiers.find((x) => x.id === m)?.priceDelta ?? 0), 0);
  return ((it?.price ?? 0) + mods) * d.qty;
}

export function pick(itemId: string): void {
  const id = state.orderId;
  if (!id) return;
  const list = (drafts[id] ??= []);
  const same = list.find((d) => d.itemId === itemId && d.course === state.course && !d.mods.length && !d.note);
  if (same) same.qty += 1;
  else list.push({ id: newId("ol"), itemId, qty: 1, course: state.course, mods: [], note: "" });
  persist();
  render();
}

export function changeDraft(draftId: string, change: Partial<Draft> | null): void {
  const id = state.orderId;
  if (!id || !drafts[id]) return;
  const d = drafts[id].find((x) => x.id === draftId);
  if (!d) return;
  if (change === null || (change.qty !== undefined && change.qty <= 0)) drafts[id] = drafts[id].filter((x) => x !== d);
  else Object.assign(d, change);
  if (!drafts[id].length) delete drafts[id];
  persist();
  render();
}

/** Save the new items to the check. fire: everything, nothing (hold), or only some courses. */
export function saveDrafts(fire: "ALL" | "NONE" | number[]): void {
  const o = order();
  const list = draftsOf(state.orderId);
  if (!o || !list.length) return;
  sending[o.id] = [...(sending[o.id] ?? []), ...list];
  delete drafts[o.id];
  persist();
  send(o.id, `${op(o)}/items`, {
    lines: list.map((d) => ({ id: d.id, menu_item_id: d.itemId, quantity: d.qty, course: d.course, note: d.note || null,
      modifiers: d.mods.map((m) => ({ modifier_id: m })) })),
    fire,
  }, t("Send to kitchen"));
  state.sheet = null; state.tab = "check";
  toast(navigator.onLine === false ? t("Saved — will send when you are back online") : fire === "NONE" ? t("Saved on the check (held)") : t("Sent to the kitchen"));
}

/* ---------- the check ---------- */

const touch = (o: Order, fn: (l: OrderLine) => void): void => { o.lines.forEach(fn); };

export function fireHeld(course: number | null): void {
  const o = order();
  if (!o) return;
  touch(o, (l) => { if (l.state === "HELD" && (course === null || l.course === course)) l.state = "SENT"; });
  send(o.id, `${op(o)}/fire`, course === null ? {} : { course }, t("Send to kitchen"));
  toast(t("Sent to the kitchen"));
}

export function markServed(): void {
  const o = order();
  if (!o) return;
  touch(o, (l) => { if (l.state === "READY") l.state = "SERVED"; });
  send(o.id, `${op(o)}/served`, {}, t("Mark served"));
  render();
}

export function removeLine(lineId: string, reason?: string): void {
  const o = order();
  const l = o?.lines.find((x) => x.id === lineId);
  if (!o || !l) return;
  if (l.state === "HELD") { o.lines = o.lines.filter((x) => x !== l); o.total -= l.total; o.due -= l.total; }
  else { l.state = "VOIDED"; l.voidReason = reason ?? ""; o.total -= l.total; o.due -= l.total; }
  send(o.id, `/floor/lines/${encodeURIComponent(lineId)}/remove`, { reason: reason ?? null }, t("Remove"));
  state.sheet = null;
  render();
}

/** From the floor's table menu, where the check itself may not be loaded yet. */
export function requestBillFor(tb: FloorTable): void {
  if (!tb.order) return;
  if (tb.order.held || draftsOf(tb.order.id).length) { toast(t("Send or remove the new and held items first."), true); return; }
  tb.status = "BILL";
  tb.order.billRequestedAt = new Date().toISOString();
  const o = orders[tb.order.id];
  if (o) { o.billRequestedAt = tb.order.billRequestedAt; o.status = "BILL"; }
  send(tb.order.id, `/floor/orders/${encodeURIComponent(tb.order.id)}/bill`, { requested: true }, t("Request bill"));
  state.sheet = null;
  toast(t("Bill requested — the cashier has been told"));
}

export function requestBill(requested: boolean, o = order()): void {
  if (!o) return;
  if (requested && (draftsOf(o.id).length || o.lines.some((l) => l.state === "HELD"))) { toast(t("Send or remove the new and held items first."), true); return; }
  o.billRequestedAt = requested ? new Date().toISOString() : null;
  if (requested) o.status = "BILL";
  const tb = tableOf(o.tableId);
  if (tb?.order) { tb.order.billRequestedAt = o.billRequestedAt; if (requested) tb.status = "BILL"; }
  send(o.id, `${op(o)}/bill`, { requested }, t("Request bill"));
  state.sheet = null;
  if (requested) toast(t("Bill requested — the cashier has been told"));
  else render();
}

export function updateCheck(o: Order, change: { guests?: number; note?: string }): void {
  if (change.guests !== undefined) o.guests = change.guests;
  if (change.note !== undefined) o.note = change.note;
  send(o.id, op(o), change, t("Save"), "PUT");
  state.sheet = null;
  render();
}

export function transfer(orderId: string, to: { waiterId?: string; tableId?: string }): void {
  send(orderId, `/floor/orders/${encodeURIComponent(orderId)}/transfer`, to, t("Transfer"));
  state.sheet = null;
  if (to.waiterId && to.waiterId !== me()?.id && !me()?.canManage) state.orderId = null;       // it is no longer mine
  render();
}

export function closeEmpty(o: Order): void {
  send(o.id, `${op(o)}/close`, {}, t("Close table (nothing ordered)"));
  delete drafts[o.id];
  persist();
  state.sheet = null; state.orderId = null;
  render();
}

export function pay(o: Order, method: PayMethod, amount: number, reference: string): void {
  send(o.id, `${op(o)}/payments`, [{ method, amount, reference: reference.trim() || null, ...(method === "CASH" ? { tendered: amount } : {}) }],
    t("Take payment"));
  state.sheet = null;
  render();
}

/* ---------- setting up tables (managers; sent directly, not queued) ---------- */

export async function addTables(names: string[]): Promise<void> {
  await api.call("POST", "/floor/tables", { names, seats: 4 });
  await loadFloor();
}
export async function editTable(id: string, change: { name?: string; active?: boolean }): Promise<void> {
  await api.call("PUT", `/floor/tables/${encodeURIComponent(id)}`, change);
  await loadFloor();
}
