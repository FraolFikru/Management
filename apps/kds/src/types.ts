/* =========================================================
   Kitchen Display System — domain types.
   Block 1 is the specification, unchanged.
   Block 2 extends it (documented) for stations, status timing,
   the order feed and UI state.
   ========================================================= */

/* ---------- 1. Specification ---------- */

export type SupportedLanguage = "en" | "am" | "om";

export type OrderType = "DINE_IN" | "TAKEOUT";

export type KDSOrderStatus = "PENDING" | "PREPARING" | "READY";

export interface OrderItemModifier {
  id: string;
  name: string;
  note?: string; // e.g., "No onion"
}

export interface KDSOrderItem {
  id: string;
  itemName: string;
  quantity: number;
  modifiers?: OrderItemModifier[];
  isCompleted: boolean;
}

export interface KDSTicket {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  tableNumber?: string;
  customerName?: string;
  items: KDSOrderItem[];
  status: KDSOrderStatus;
  createdAt: string; // ISO Timestamp
  /** Server snapshot only. The UI always recomputes elapsed time from createdAt. */
  elapsedMinutes: number;
  submittedBy: string; // Cashier ID / Name
  submittedByName?: string; // display name sent by the SEER backend
}

/* ---------- 2. Extensions ---------- */

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

/** Kitchen line stations. Each menu item is cooked at exactly one station. */
export type KitchenStation = "GRILL" | "HOT_KITCHEN" | "SALAD" | "BAR";

/** Station filter: one station, or every station combined. */
export type StationFilter = KitchenStation | "ALL";

export type OrderTypeFilter = OrderType | "ALL";

/** A ticket line plus the station that cooks it and a link to the menu. */
export interface KitchenItem extends KDSOrderItem {
  /** Admin price-book item ID; used to show the dish name in the current language. */
  menuItemId: string;
  station: KitchenStation;
}

/** A ticket plus branch and status timing. */
export interface KitchenTicket extends KDSTicket {
  items: KitchenItem[];
  branchId: string;
  /** set when the ticket first moves to PREPARING */
  startedAt?: string;
  /** set when the ticket moves to READY; the timer freezes here */
  readyAt?: string;
}

/** Elapsed-time urgency band. */
export type Urgency = "ok" | "warn" | "late";

/* --- order feed (backend contract) --- */

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/** Events the backend pushes to the KDS. */
export type FeedEvent =
  | { type: "snapshot"; tickets: KitchenTicket[] }
  | { type: "upsert"; ticket: KitchenTicket }
  | { type: "remove"; ticketId: string };

/** Commands the KDS sends to the backend. Every command carries who did it and when. */
export type FeedCommand =
  | { type: "status"; ticketId: string; status: KDSOrderStatus; at: string; by: string }
  | { type: "item"; ticketId: string; itemId: string; isCompleted: boolean; at: string; by: string }
  | { type: "bump"; ticketId: string; at: string; by: string }
  | { type: "recall"; ticketId: string; at: string; by: string };

export interface OrderFeed {
  readonly kind: "demo" | "live";
  connect(onEvent: (e: FeedEvent) => void, onState: (s: ConnectionState) => void): void;
  disconnect(): void;
  /** Resolves when the backend accepts the command; rejects so the UI can roll back. */
  send(cmd: FeedCommand): Promise<void>;
}
