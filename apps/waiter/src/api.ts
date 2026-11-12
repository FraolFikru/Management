/* =========================================================
   Connection to the SEER backend.

   Reads go straight to the server. Writes go through a small
   queue kept on the phone: when the network drops on the floor
   the action waits and is sent again (with the same Idempotency
   key, so nothing is doubled) as soon as the server answers.
   ========================================================= */

import type { Floor, Menu, Order } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");
export const isConfigured = BASE.length > 0;
const WS_URL = (import.meta.env.VITE_WS_URL ?? "").trim() || `${BASE.replace(/^http/, "ws")}/ws`;

export interface SessionUser { id: string; name: string; role: string; branchId: string | null; staffCode: string | null; initials: string | null }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** The request never reached the server (no signal, server asleep). */
export class Offline extends Error {
  constructor(message: string, readonly serverError = false) { super(message); }
}

const KEY = "seer.waiter.session";
const read = <T>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const write = (k: string, v: unknown): void => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

let session: Session | null = read<Session>(KEY);
const saveSession = (s: Session | null): void => { session = s; write(KEY, s); };
export const sessionUser = (): SessionUser | null => session?.user ?? null;
export function setBranch(id: string): void { if (session) saveSession({ ...session, user: { ...session.user, branchId: id } }); }

let onSignedOut: () => void = () => {};
export function onSessionLost(fn: () => void): void { onSignedOut = fn; }

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (session) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    if (session.user.branchId) headers.set("X-Branch-Id", session.user.branchId);
  }
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new Offline("offline");
  }
}

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    if (!session) return false;
    const res = await raw("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) });
    if (!res.ok) return false;
    const s = (await res.json()) as Session;
    saveSession({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: { ...s.user, branchId: s.user.branchId ?? session?.user.branchId ?? null } });
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401) {
    if (await refresh()) res = await raw(path, init);
    else { saveSession(null); onSignedOut(); throw new ApiError("signed-out", 401); }
  }
  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try {
      const body = await res.json();
      msg = body.error ?? body.message ?? (typeof body.detail === "string" ? body.detail : msg);
    } catch { /* not JSON */ }
    if (res.status >= 500 && res.status !== 501) throw new Offline(msg, true);   // server waking up / restarting: try again
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

async function start(path: string, body: unknown): Promise<SessionUser> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Offline("offline"); }
  if (!res.ok) throw new ApiError(res.status === 401 ? "wrong" : res.status === 429 ? "locked" : `Server error (${res.status})`, res.status);
  const s = (await res.json()) as Session;
  saveSession({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
  return s.user;
}
export const signInPin = (staffCode: string, pin: string): Promise<SessionUser> => start("/auth/staff-pin", { staffCode: staffCode.trim(), pin });
export const signInPassword = (username: string, password: string): Promise<SessionUser> => start("/auth/login", { username: username.trim(), password });

export async function signOut(): Promise<void> {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* expired or offline: nothing to revoke */ }
  saveSession(null);
  write(QKEY, null);
  queue = [];
}

/* ---------- reads ---------- */

export const getFloor = (): Promise<Floor> => api<Floor>("/floor");
export const getMenu = (): Promise<Menu> => api<Menu>("/floor/menu");
export const getOrder = (id: string): Promise<Order> => api<Order>(`/floor/orders/${encodeURIComponent(id)}`);
export const getBranches = async (): Promise<{ id: string; name: string }[]> => (await api<{ branches: { id: string; name: string }[] }>("/auth/me")).branches;

/** A direct (not queued) write, for screens that wait for the answer. */
export const call = <T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> => api<T>(path, { method, body: JSON.stringify(body) });

/* ---------- writes: the queue ---------- */

export interface Action {
  key: string;                 // Idempotency-Key
  orderId: string;
  method: "POST" | "PUT";
  path: string;
  body: unknown;
  /** what to tell the waiter if the server refuses it */
  label: string;
}

const QKEY = "seer.waiter.queue";
let queue: Action[] = read<Action[]>(QKEY) ?? [];
let running = false;
let timer: number | undefined;
let serverErrors = 0;           // a 5xx is retried a few times, then treated as a refusal (so a broken request can't block the queue)

export interface QueueEvents {
  done(a: Action, result: unknown): void;
  refused(a: Action, message: string): void;
  changed(pending: number, offline: boolean): void;
}
let events: QueueEvents = { done() {}, refused() {}, changed() {} };
export function onQueue(e: QueueEvents): void { events = e; }
export const pendingCount = (): number => queue.length;
export const pendingFor = (orderId: string): boolean => queue.some((a) => a.orderId === orderId);

export function enqueue(a: Omit<Action, "key">): void {
  queue.push({ ...a, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` });
  write(QKEY, queue);
  events.changed(queue.length, false);
  void drain();
}

export async function drain(): Promise<void> {
  if (running) return;
  running = true;
  window.clearTimeout(timer);
  while (queue.length) {
    const a = queue[0];
    try {
      const out = await api<unknown>(a.path, { method: a.method, body: JSON.stringify(a.body), headers: { "Idempotency-Key": a.key } });
      queue.shift();
      serverErrors = 0;
      write(QKEY, queue);
      events.done(a, out);
      events.changed(queue.length, false);
    } catch (err) {
      if (err instanceof Offline && !(err.serverError && ++serverErrors > 5)) {   // keep it, try again shortly
        events.changed(queue.length, true);
        timer = window.setTimeout(() => void drain(), 4000);
        break;
      }
      // refused: drop it, and whatever else was waiting for the same check (it depended on this)
      const msg = err instanceof Error ? err.message : String(err);
      serverErrors = 0;
      queue = queue.filter((x) => x !== a && x.orderId !== a.orderId);
      write(QKEY, queue);
      if (msg !== "signed-out") events.refused(a, msg);
      events.changed(queue.length, false);
    }
  }
  running = false;
}
window.addEventListener("online", () => void drain());

/* ---------- live updates ---------- */

/** Calls `onEvent` whenever a table in this branch changes. Reconnects by itself; `onState(false)` = fall back to polling. */
export function connectLive(onEvent: () => void, onState: (live: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let ping: number | undefined;
  const open = async (): Promise<void> => {
    if (stopped || !session?.user.branchId) return;
    if (attempt > 0) { try { await refresh(); } catch { /* offline: retry below */ } }       // the access token lasts 15 minutes
    if (stopped || !session) return;
    try {
      const url = new URL(WS_URL);
      url.searchParams.set("branch", session.user.branchId ?? "");
      url.searchParams.set("token", session.accessToken);
      url.searchParams.set("topics", "floor");
      ws = new WebSocket(url);
    } catch { onState(false); return; }
    ws.onopen = () => { attempt = 0; onState(true); ping = window.setInterval(() => { try { ws?.send("ping"); } catch { /* closing */ } }, 25000); };
    ws.onmessage = () => onEvent();
    ws.onclose = () => {
      window.clearInterval(ping);
      onState(false);
      if (!stopped) window.setTimeout(() => void open(), Math.min(30000, 1500 * 2 ** attempt++));
    };
    ws.onerror = () => ws?.close();
  };
  void open();
  return () => { stopped = true; window.clearInterval(ping); ws?.close(); };
}

export const cache = { read, write };
