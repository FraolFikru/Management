/* =========================================================
   Live feed: WebSocket for pushed ticket events, REST for commands.

   Server → KDS (WebSocket, JSON):
     { "type": "snapshot", "tickets": KitchenTicket[] }   on every (re)connect
     { "type": "upsert",   "ticket":  KitchenTicket }     new or changed ticket
     { "type": "remove",   "ticketId": string }           picked up / voided

   KDS → Server (REST, JSON body = the FeedCommand):
     POST {api}/kds/tickets/{id}/status   { status, at, by }
     POST {api}/kds/tickets/{id}/item     { itemId, isCompleted, at, by }
     POST {api}/kds/tickets/{id}/bump     { at, by }
     POST {api}/kds/tickets/{id}/recall   { at, by }
   Each request carries an Idempotency-Key so a retry never applies twice.
   Auth (SEER): Authorization: Bearer <token> on REST, ?token= on the
   WebSocket (browsers cannot set WebSocket headers).
   The server echoes the result as an "upsert" to every screen in the branch.
   ========================================================= */

import type { ConnectionState, FeedCommand, FeedEvent, OrderFeed } from "../types";
import { parseEvent } from "./validate";
import { accessToken, handleUnauthorized } from "../auth";

const MAX_BACKOFF_MS = 30_000;
const SEND_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const newKey = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class LiveOrderFeed implements OrderFeed {
  readonly kind = "live" as const;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closed = false;
  private retryTimer: number | undefined;
  private onEvent: (e: FeedEvent) => void = () => {};
  private onState: (s: ConnectionState) => void = () => {};

  constructor(private readonly wsUrl: string, private readonly apiUrl: string, private readonly branchId: string) {}

  connect(onEvent: (e: FeedEvent) => void, onState: (s: ConnectionState) => void): void {
    this.onEvent = onEvent;
    this.onState = onState;
    this.closed = false;
    this.open();
    window.addEventListener("online", this.reconnectNow);
  }

  disconnect(): void {
    this.closed = true;
    window.clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.reconnectNow);
    this.drop();
  }

  async send(cmd: FeedCommand): Promise<void> {
    const { type, ticketId, ...body } = cmd;
    const url = `${this.apiUrl.replace(/\/$/, "")}/kds/tickets/${encodeURIComponent(ticketId)}/${type}`;
    const key = newKey();
    let lastError: unknown;
    for (let i = 0; i < SEND_ATTEMPTS; i++) {
      try {
        const token = await accessToken(i > 0);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json", "Idempotency-Key": key, "X-Branch-Id": this.branchId,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        if (res.status === 401 && i === 0) continue;                     // token expired: refresh and retry once
        if (res.status === 401) { handleUnauthorized(); throw new Error("Rejected (401)"); }
        if (res.status >= 400 && res.status < 500) throw new Error(`Rejected (${res.status})`); // don't retry client errors
        lastError = new Error(`Server error (${res.status})`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Rejected")) throw err;
        lastError = err;
      }
      await sleep(500 * 2 ** i);
    }
    throw lastError instanceof Error ? lastError : new Error("Send failed");
  }

  private async open(): Promise<void> {
    this.onState(this.attempt === 0 ? "connecting" : "reconnecting");
    const url = new URL(this.wsUrl);
    url.searchParams.set("branch", this.branchId);
    const token = await accessToken();
    if (token) url.searchParams.set("token", token);
    if (this.closed) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.onState("live"); };
    ws.onmessage = (m) => {
      const e = typeof m.data === "string" ? parseEvent(m.data) : null;
      if (e) this.onEvent(e);
    };
    ws.onclose = (ev) => {
      if (this.closed) return;
      if (ev.code === 4401 || ev.code === 4403) { handleUnauthorized(); return; }   // signed out / no access to this branch
      this.attempt++;
      this.onState(navigator.onLine ? "reconnecting" : "offline");
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempt, 5)) * (0.75 + Math.random() * 0.5);
      this.retryTimer = window.setTimeout(() => void this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private reconnectNow = (): void => {
    if (this.closed || this.ws?.readyState === WebSocket.OPEN) return;
    window.clearTimeout(this.retryTimer);
    this.drop();
    void this.open();
  };

  /** Close the current socket without triggering the reconnect logic. */
  private drop(): void {
    if (!this.ws) return;
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.close();
    this.ws = null;
  }
}
