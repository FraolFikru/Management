/* =========================================================
   KDS state and actions.
   - The board is a map of tickets kept in sync by the order feed.
   - Every action is optimistic: the screen changes at once, the
     command goes to the backend, and a failure rolls it back.
   - The backend's echo ("upsert") is always the final word.
   ========================================================= */

import type {
  ConnectionState, FeedCommand, FeedEvent, KDSOrderStatus, KitchenItem, KitchenStation, KitchenTicket,
  OrderFeed, OrderTypeFilter, StationFilter, SupportedLanguage, Urgency,
} from "./types";
import { KDS_OPERATOR, NEW_BADGE_MS, RECALL_LIMIT, STATIONS, URGENCY_MINUTES } from "./catalog";
import { isLanguage, setLanguage } from "./i18n";

/* ---------- preferences (per screen) ---------- */

const PREFS_KEY = "kds-prefs-v1";

interface Prefs {
  lang: SupportedLanguage;
  station: StationFilter;
  type: OrderTypeFilter;
  sound: boolean;
  theme: "dark" | "light";
}

function loadPrefs(): Prefs {
  const d: Prefs = { lang: "en", station: "ALL", type: "ALL", sound: true, theme: "dark" };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      lang: isLanguage(p.lang) ? p.lang : d.lang,
      station: p.station === "ALL" || STATIONS.includes(p.station as KitchenStation) ? (p.station as StationFilter) : d.station,
      type: p.type === "DINE_IN" || p.type === "TAKEOUT" ? p.type : d.type,
      sound: typeof p.sound === "boolean" ? p.sound : d.sound,
      theme: p.theme === "light" ? "light" : "dark",
    };
  } catch {
    return d;
  }
}

export const state = {
  ...loadPrefs(),
  connection: "connecting" as ConnectionState,
  tickets: new Map<string, KitchenTicket>(),
  /** ticket id → time the NEW badge expires */
  fresh: new Map<string, number>(),
  /** ticket ids with a command in flight (buttons disabled) */
  busy: new Set<string>(),
  /** most recent last; snapshots so a recall can show the ticket at once */
  recall: [] as KitchenTicket[],
  /** prep durations (ms) of tickets marked ready on this screen, newest last */
  prepTimes: [] as number[],
  now: Date.now(),
};
setLanguage(state.lang);
applyTheme();

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "dark" ? "#000000" : "#ffffff");
}

export function savePrefs(): void {
  try {
    const { lang, station, type, sound, theme } = state;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang, station, type, sound, theme }));
  } catch { /* private mode or full storage: preferences just won't persist */ }
}

/* ---------- change notification ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();
export const subscribe = (fn: Listener): void => void listeners.add(fn);
const changed = (): void => listeners.forEach((fn) => fn());

let onArrival: (tickets: KitchenTicket[]) => void = () => {};
let onFailure: () => void = () => {};
export function onNewTickets(fn: (tickets: KitchenTicket[]) => void): void { onArrival = fn; }
export function onSendFailure(fn: () => void): void { onFailure = fn; }

/* ---------- derived values ---------- */

export const elapsedMs = (tk: KitchenTicket, now = state.now): number =>
  (tk.readyAt ? Date.parse(tk.readyAt) : now) - Date.parse(tk.createdAt);

export function urgencyOf(ms: number): Urgency {
  const min = ms / 60_000;
  return min >= URGENCY_MINUTES.LATE ? "late" : min >= URGENCY_MINUTES.WARN ? "warn" : "ok";
}

export const isFresh = (id: string): boolean => (state.fresh.get(id) ?? 0) > state.now;

/** Items this screen should show for a ticket, given the station filter. */
export const itemsFor = (tk: KitchenTicket, station: StationFilter = state.station): KitchenItem[] =>
  station === "ALL" ? tk.items : tk.items.filter((i) => i.station === station);

const matchesType = (tk: KitchenTicket): boolean => state.type === "ALL" || tk.orderType === state.type;

/** Tickets for one column, oldest first (first in, first out). */
export function column(status: KDSOrderStatus): KitchenTicket[] {
  return [...state.tickets.values()]
    .filter((tk) => tk.status === status && matchesType(tk) && itemsFor(tk).length > 0)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Open (not ready) tickets that still have unfinished work at a station. */
export function openCount(station: StationFilter): number {
  let n = 0;
  for (const tk of state.tickets.values()) {
    if (tk.status === "READY" || !matchesType(tk)) continue;
    if (itemsFor(tk, station).some((i) => !i.isCompleted)) n++;
  }
  return n;
}

export function lateCount(): number {
  let n = 0;
  for (const tk of state.tickets.values()) if (tk.status !== "READY" && itemsFor(tk).length && urgencyOf(elapsedMs(tk)) === "late") n++;
  return n;
}

export function avgPrepMs(): number | null {
  const last = state.prepTimes.slice(-20);
  return last.length ? last.reduce((a, b) => a + b, 0) / last.length : null;
}

/* ---------- feed events ---------- */

let feed: OrderFeed | null = null;

export function attachFeed(f: OrderFeed): void {
  feed = f;
  f.connect(handleEvent, (s) => { state.connection = s; changed(); });
}

export const feedKind = (): OrderFeed["kind"] | null => feed?.kind ?? null;

function handleEvent(e: FeedEvent): void {
  const arrived: KitchenTicket[] = [];
  if (e.type === "snapshot") {
    const hadBoard = state.tickets.size > 0;
    const next = new Map(e.tickets.map((tk) => [tk.id, tk] as const));
    // after a reconnect, anything we had not seen is new
    if (hadBoard) for (const tk of e.tickets) if (!state.tickets.has(tk.id) && tk.status === "PENDING") arrived.push(tk);
    state.tickets = next;
  } else if (e.type === "upsert") {
    const prev = state.tickets.get(e.ticket.id);
    if (!prev && e.ticket.status === "PENDING") arrived.push(e.ticket);
    // marked ready on another screen (our own optimistic change already shows READY, so it isn't counted twice)
    if (prev && prev.status !== "READY" && e.ticket.status === "READY" && e.ticket.readyAt) recordPrep(e.ticket);
    state.tickets.set(e.ticket.id, e.ticket);
  } else {
    state.tickets.delete(e.ticketId);
  }
  for (const tk of arrived) state.fresh.set(tk.id, Date.now() + NEW_BADGE_MS);
  changed();
  if (arrived.length) onArrival(arrived);
}

function recordPrep(tk: KitchenTicket): void {
  state.prepTimes.push(elapsedMs(tk));
  if (state.prepTimes.length > 50) state.prepTimes.shift();
}

/* ---------- actions ---------- */

const nowIso = (): string => new Date().toISOString();

/** Apply a local change, send commands, roll back if the backend refuses. */
async function commit(id: string, mutate: (tk: KitchenTicket) => void, cmds: FeedCommand[]): Promise<boolean> {
  const tk = state.tickets.get(id);
  if (!tk || !feed || state.busy.has(id)) return false;
  const before = structuredClone(tk);
  mutate(tk);
  state.busy.add(id);
  changed();
  try {
    for (const c of cmds) await feed.send(c);
    return true;
  } catch (err) {
    console.error("[kds] command failed", cmds, err);
    if (state.tickets.has(id)) state.tickets.set(id, before);
    onFailure();
    return false;
  } finally {
    state.busy.delete(id);
    changed();
  }
}

function applyStatus(tk: KitchenTicket, status: KDSOrderStatus, at: string): void {
  tk.status = status;
  if (status === "PENDING") { delete tk.startedAt; delete tk.readyAt; }
  if (status === "PREPARING") { tk.startedAt ??= at; delete tk.readyAt; }
  if (status === "READY") { tk.readyAt = at; for (const i of tk.items) i.isCompleted = true; }
}

export async function setStatus(id: string, status: KDSOrderStatus): Promise<boolean> {
  const at = nowIso();
  const ok = await commit(id, (x) => applyStatus(x, status, at), [{ type: "status", ticketId: id, status, at, by: KDS_OPERATOR }]);
  const tk = state.tickets.get(id);
  if (ok && status === "READY" && tk) recordPrep(tk);
  return ok;
}

/** Tick a dish done or not done. Ticking the first dish on a new ticket also starts it. */
export function toggleItem(ticketId: string, itemId: string): Promise<boolean> {
  const tk = state.tickets.get(ticketId);
  const it = tk?.items.find((i) => i.id === itemId);
  if (!tk || !it || tk.status === "READY") return Promise.resolve(false);
  const at = nowIso();
  const done = !it.isCompleted;
  const cmds: FeedCommand[] = [];
  if (tk.status === "PENDING" && done) cmds.push({ type: "status", ticketId, status: "PREPARING", at, by: KDS_OPERATOR });
  cmds.push({ type: "item", ticketId, itemId, isCompleted: done, at, by: KDS_OPERATOR });
  return commit(ticketId, (x) => {
    if (x.status === "PENDING" && done) applyStatus(x, "PREPARING", at);
    const target = x.items.find((i) => i.id === itemId);
    if (target) target.isCompleted = done;
  }, cmds);
}

/** Picked up by the waiter / handed to the customer: leaves the board, can be recalled. */
export async function bump(id: string): Promise<boolean> {
  const tk = state.tickets.get(id);
  if (!tk || !feed || state.busy.has(id)) return false;
  const snap = structuredClone(tk);
  state.tickets.delete(id);
  state.recall.push(snap);
  if (state.recall.length > RECALL_LIMIT) state.recall.shift();
  changed();
  try {
    await feed.send({ type: "bump", ticketId: id, at: nowIso(), by: KDS_OPERATOR });
    return true;
  } catch (err) {
    console.error("[kds] bump failed", err);
    state.recall = state.recall.filter((r) => r.id !== id);
    state.tickets.set(id, snap);
    onFailure();
    changed();
    return false;
  }
}

/** Bring back the most recently picked-up ticket (or a specific one). */
export async function recall(id?: string): Promise<KitchenTicket | null> {
  const idx = id ? state.recall.findIndex((r) => r.id === id) : state.recall.length - 1;
  const snap = state.recall[idx];
  if (!snap || !feed) return null;
  state.recall.splice(idx, 1);
  state.tickets.set(snap.id, structuredClone(snap));
  changed();
  try {
    await feed.send({ type: "recall", ticketId: snap.id, at: nowIso(), by: KDS_OPERATOR });
    return snap;
  } catch (err) {
    console.error("[kds] recall failed", err);
    state.tickets.delete(snap.id);
    state.recall.splice(idx, 0, snap);
    onFailure();
    changed();
    return null;
  }
}

/* ---------- filters & preferences ---------- */

export function setStation(s: StationFilter): void { state.station = s; savePrefs(); changed(); }
export function setType(tp: OrderTypeFilter): void { state.type = tp; savePrefs(); changed(); }
export function setSound(on: boolean): void { state.sound = on; savePrefs(); changed(); }
export function toggleTheme(): void { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); savePrefs(); changed(); }
export function setLang(l: SupportedLanguage): void { state.lang = l; setLanguage(l); savePrefs(); changed(); }

/** Called once a second by the clock; returns true when a NEW badge expired (needs a re-render). */
export function tick(): boolean {
  state.now = Date.now();
  let expired = false;
  for (const [id, until] of state.fresh) if (until <= state.now) { state.fresh.delete(id); expired = true; }
  return expired;
}
