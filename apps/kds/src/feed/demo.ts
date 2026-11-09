/* =========================================================
   Demo feed: behaves like the live backend, in memory.
   Starts with a realistic mid-service board and sends a new
   order every 30–70 seconds, so timers, colours and sounds can
   be seen working without a server.
   ========================================================= */

import type { ConnectionState, FeedCommand, FeedEvent, KitchenItem, KitchenTicket, OrderFeed, OrderItemModifier } from "../types";
import { MENU, MODIFIERS, STAFF } from "../catalog";

const BRANCH = "BR-BOLE-01";
const minsAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)] as T;
const rand = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));

let seq = 140;
let lineSeq = 0;

function mod(id: string, note?: string): OrderItemModifier {
  return { id, name: MODIFIERS[id]?.en ?? id, ...(note ? { note } : {}) };
}

function line(menuId: string, qty: number, mods: OrderItemModifier[] = [], done = false): KitchenItem {
  const m = MENU.find((x) => x.id === menuId);
  if (!m) throw new Error(`Unknown menu item ${menuId}`);
  return { id: `ln-${++lineSeq}`, menuItemId: m.id, itemName: m.name.en, station: m.station, quantity: qty, isCompleted: done, ...(mods.length ? { modifiers: mods } : {}) };
}

function ticket(p: Partial<KitchenTicket> & Pick<KitchenTicket, "items" | "orderType">, ageMin: number): KitchenTicket {
  const createdAt = minsAgo(ageMin);
  const no = ++seq;
  return {
    id: `tk-${no}`,
    orderNumber: `B-${String(no).padStart(4, "0")}`,
    status: "PENDING",
    createdAt,
    elapsedMinutes: Math.floor(ageMin),
    submittedBy: pick(Object.keys(STAFF)),
    branchId: BRANCH,
    ...p,
  };
}

function seedBoard(): KitchenTicket[] {
  return [
    ticket({ orderType: "DINE_IN", tableNumber: "7", status: "PREPARING", startedAt: minsAgo(21), items: [
      line("doro-wat", 2, [mod("extra-injera")], true), line("beef-tibs", 1, [mod("well-done"), mod("no-onion")]), line("jebena", 1, [], true)] }, 24.5),
    ticket({ orderType: "TAKEOUT", customerName: "Bethlehem", status: "PREPARING", startedAt: minsAgo(12), items: [
      line("beyaynetu", 2, [mod("fasting")]), line("azifa", 1)] }, 14.2),
    ticket({ orderType: "DINE_IN", tableNumber: "3", status: "PREPARING", startedAt: minsAgo(5), items: [
      line("kitfo", 1, [mod("leb-leb"), mod("mitmita")]), line("timatim", 1, [], true), line("macchiato", 2, [mod("no-sugar")])] }, 6.4),
    ticket({ orderType: "DINE_IN", tableNumber: "12", items: [
      line("lamb-tibs", 2, [mod("extra-berbere")]), line("shiro", 1, [mod("allergy", "Peanut allergy, use a clean pan")]), line("juice", 2, [mod("no-ice")])] }, 11.3),
    ticket({ orderType: "TAKEOUT", customerName: "Abdi", items: [line("firfir", 2), line("macchiato", 1)] }, 3.1),
    ticket({ orderType: "DINE_IN", tableNumber: "5", items: [line("misir", 1, [mod("mild")]), line("tej", 2)] }, 1.2),
    ticket({ orderType: "DINE_IN", tableNumber: "9", status: "READY", startedAt: minsAgo(15), readyAt: minsAgo(2), items: [
      line("doro-wat", 1, [], true), line("timatim", 1, [], true)] }, 17),
    ticket({ orderType: "TAKEOUT", customerName: "Hirut", status: "READY", startedAt: minsAgo(9), readyAt: minsAgo(0.6), items: [line("beef-tibs", 1, [mod("tere")], true)] }, 9.8),
  ];
}

function randomOrder(): KitchenTicket {
  const dine = Math.random() < 0.65;
  const n = rand(1, 4);
  const items: KitchenItem[] = [];
  const used = new Set<string>();
  while (items.length < n) {
    const m = pick(MENU);
    if (used.has(m.id)) continue;
    used.add(m.id);
    const modIds = Object.keys(MODIFIERS).filter((k) => k !== "allergy");
    const mods = Math.random() < 0.4 ? [mod(pick(modIds))] : [];
    items.push(line(m.id, Math.random() < 0.7 ? 1 : 2, mods));
  }
  return ticket(dine ? { orderType: "DINE_IN", tableNumber: String(rand(1, 18)), items } : { orderType: "TAKEOUT", customerName: pick(["Kebede", "Sara", "Tigist", "Dawit", "Feven", "Mohammed"]), items }, 0);
}

export class DemoOrderFeed implements OrderFeed {
  readonly kind = "demo" as const;
  private tickets = new Map<string, KitchenTicket>();
  private archive = new Map<string, KitchenTicket>();
  private timer: number | undefined;
  private emit: (e: FeedEvent) => void = () => {};

  connect(onEvent: (e: FeedEvent) => void, onState: (s: ConnectionState) => void): void {
    this.emit = onEvent;
    onState("connecting");
    for (const tk of seedBoard()) this.tickets.set(tk.id, tk);
    window.setTimeout(() => {
      onState("live");
      this.emit({ type: "snapshot", tickets: [...this.tickets.values()].map(clone) });
      this.schedule(8_000);
    }, 250);
  }

  disconnect(): void {
    window.clearTimeout(this.timer);
  }

  async send(cmd: FeedCommand): Promise<void> {
    await new Promise((r) => setTimeout(r, 120)); // network round trip
    if (cmd.type === "recall") {
      const tk = this.archive.get(cmd.ticketId);
      if (!tk) throw new Error("Not found");
      this.archive.delete(tk.id);
      this.tickets.set(tk.id, tk);
      this.emit({ type: "upsert", ticket: clone(tk) });
      return;
    }
    const tk = this.tickets.get(cmd.ticketId);
    if (!tk) throw new Error("Not found");
    if (cmd.type === "bump") {
      this.tickets.delete(tk.id);
      this.archive.set(tk.id, tk);
      this.emit({ type: "remove", ticketId: tk.id });
      return;
    }
    if (cmd.type === "item") {
      const it = tk.items.find((i) => i.id === cmd.itemId);
      if (!it) throw new Error("Not found");
      it.isCompleted = cmd.isCompleted;
    } else {
      tk.status = cmd.status;
      if (cmd.status === "PENDING") { delete tk.startedAt; delete tk.readyAt; }
      if (cmd.status === "PREPARING") { tk.startedAt ??= cmd.at; delete tk.readyAt; }
      if (cmd.status === "READY") { tk.readyAt = cmd.at; for (const i of tk.items) i.isCompleted = true; }
    }
    this.emit({ type: "upsert", ticket: clone(tk) });
  }

  private schedule(ms: number): void {
    this.timer = window.setTimeout(() => {
      const tk = randomOrder();
      this.tickets.set(tk.id, tk);
      this.emit({ type: "upsert", ticket: clone(tk) });
      this.schedule(rand(30, 70) * 1000);
    }, ms);
  }
}

const clone = (t: KitchenTicket): KitchenTicket => structuredClone(t);
