/* Runtime checks for data arriving from the network. A malformed ticket is
   dropped (and logged) instead of breaking the whole board. */

import type { FeedEvent, KitchenItem, KitchenStation, KitchenTicket } from "../types";

const STATIONS: readonly KitchenStation[] = ["GRILL", "HOT_KITCHEN", "SALAD", "BAR"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optStr = (v: unknown): boolean => v === undefined || typeof v === "string";

function isItem(v: unknown): v is KitchenItem {
  if (!isObj(v)) return false;
  return str(v.id) && str(v.itemName) && str(v.menuItemId) && typeof v.quantity === "number" && v.quantity > 0
    && typeof v.isCompleted === "boolean" && STATIONS.includes(v.station as KitchenStation)
    && (v.modifiers === undefined || (Array.isArray(v.modifiers) && v.modifiers.every((m) => isObj(m) && str(m.id) && typeof m.name === "string" && optStr(m.note))));
}

export function isTicket(v: unknown): v is KitchenTicket {
  if (!isObj(v)) return false;
  return str(v.id) && str(v.orderNumber) && (v.orderType === "DINE_IN" || v.orderType === "TAKEOUT")
    && (v.status === "PENDING" || v.status === "PREPARING" || v.status === "READY")
    && str(v.createdAt) && !Number.isNaN(Date.parse(v.createdAt as string)) && str(v.submittedBy) && str(v.branchId)
    && optStr(v.tableNumber) && optStr(v.customerName) && optStr(v.startedAt) && optStr(v.readyAt)
    && Array.isArray(v.items) && v.items.length > 0 && v.items.every(isItem);
}

/** Parse one WebSocket message into a FeedEvent, or null if it is not one. */
export function parseEvent(raw: string): FeedEvent | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v)) return null;
  if (v.type === "snapshot" && Array.isArray(v.tickets)) {
    const tickets = v.tickets.filter((x) => isTicket(x) || (console.warn("[kds] dropped malformed ticket", x), false));
    return { type: "snapshot", tickets: tickets as KitchenTicket[] };
  }
  if (v.type === "upsert") return isTicket(v.ticket) ? { type: "upsert", ticket: v.ticket } : (console.warn("[kds] dropped malformed ticket", v.ticket), null);
  if (v.type === "remove" && str(v.ticketId)) return { type: "remove", ticketId: v.ticketId };
  return null;
}
