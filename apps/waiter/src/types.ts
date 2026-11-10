export type Lang = "en" | "am" | "om";
export type Names = Record<Lang, string>;

/** Table status, worked out by the backend from the check. */
export type TableStatus = "FREE" | "SEATED" | "IN_KITCHEN" | "READY" | "SERVED" | "BILL";
/** Where one item is: on the check only (held), with the kitchen, ready, on the table, or voided. */
export type LineState = "HELD" | "SENT" | "PREPARING" | "READY" | "SERVED" | "VOIDED";
export type PayMethod = "CASH" | "TELEBIRR" | "CBE_BIRR";

export interface TableOrder {
  id: string; orderNumber: string; guests: number; openedAt: string; total: number; due: number;
  waiterId: string | null; waiterName: string | null; billRequestedAt: string | null; ready: number; held: number;
}
export interface FloorTable { id: string; name: string; seats: number; area: string | null; status: TableStatus; order?: TableOrder }
export interface Me { id: string; name: string; role: string; canManage: boolean; canSetup: boolean; canCash: boolean }
export interface Floor {
  serverTime: string; branch: { id: string; name: string }; tables: FloorTable[];
  waiters: { id: string; name: string; role: string }[]; me: Me;
}

export interface MenuItem { id: string; name: Names; category: string; price: number; fasting: boolean; beverage: boolean; modifiers?: string[] }
export interface Menu {
  categories: { code: string; name: Names }[];
  items: MenuItem[];
  modifiers: { id: string; name: Names; priceDelta: number }[];
}

export interface OrderLine {
  id: string; menuItemId: string; name: string; quantity: number; unitPrice: number; total: number; course: number;
  note: string; modifiers: { id: string; name: string }[]; state: LineState; voidReason: string | null;
}
export interface Order {
  id: string; orderNumber: string; tableId: string; tableName: string; guests: number; waiterId: string | null; waiterName: string | null;
  openedAt: string; note: string; billRequestedAt: string | null; orderStatus: string; status: TableStatus | "PAID" | "VOIDED";
  total: number; vat: number; paid: number; due: number; receiptNo: string | null; lines: OrderLine[];
  payments: { method: PayMethod; amount: number; reference: string | null }[];
}

/** An item picked on this phone and not yet saved to the check. */
export interface Draft { id: string; itemId: string; qty: number; course: number; mods: string[]; note: string }
