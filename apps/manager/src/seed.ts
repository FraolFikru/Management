/* =========================================================
   Deterministic sample data for the Bole branch (~30 days, relative
   to today): customer sales, stock purchases under review, dispatch
   requests from the Sales Department, waste logs and petty-cash
   expenses. Every record carries a staff ID; decisions carry the
   manager's ID and time, with matching audit entries.
   ========================================================= */

import type {
  AuditEntry, CogsPurchase, DispatchRecord, Destination, ExpenseRecord, ExpenseSource, InventoryItem, PaymentMethod,
  SaleLine, WasteLog, WasteReason,
} from "./types";
import { BASE_INVENTORY, MENU, shiftOf } from "./catalog";
import { addDays, round2, stamp, today } from "./format";

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedData {
  inventory: InventoryItem[];
  sales: SaleLine[];
  purchases: CogsPurchase[];
  dispatches: DispatchRecord[];
  waste: WasteLog[];
  expenses: ExpenseRecord[];
  audit: AuditEntry[];
}

const MANAGER = "BM-001";
const CLERK = "IC-201";
const SALES = ["SS-104", "SS-117", "SS-122"];

export function generateSeed(): SeedData {
  const r = rng(20261106);
  const now = today();
  const nowMs = Date.now();
  const between = (a: number, b: number): number => Math.round(a + r() * (b - a));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const past = (iso: string): boolean => new Date(iso).getTime() <= nowMs;
  const minsAgo = (m: number): string => new Date(nowMs - m * 60_000).toISOString();

  const inventory: InventoryItem[] = BASE_INVENTORY.map((i) => ({ ...i, aliases: [...i.aliases], currentQuantity: Math.round(i.reorderPoint * (0.8 + r() * 2.4)) }));
  // a few items deliberately below their reorder point
  for (const id of ["berbere", "kibbeh", "takeout-box", "soft-drinks"]) {
    const it = inventory.find((x) => x.id === id);
    if (it) it.currentQuantity = Math.max(1, Math.floor(it.reorderPoint * 0.5));
  }
  // exactly at the threshold (counts as low: currentQuantity <= reorderPoint) and one sold out
  for (const [id, f] of [["milk", 1], ["dish-soap", 0.9], ["straws", 0]] as const) {
    const it = inventory.find((x) => x.id === id);
    if (it) it.currentQuantity = Math.round(it.reorderPoint * f);
  }
  const item = (id: string): InventoryItem => {
    const it = inventory.find((x) => x.id === id);
    if (!it) throw new Error(id);
    return it;
  };

  const out: SeedData = { inventory, sales: [], purchases: [], dispatches: [], waste: [], expenses: [], audit: [] };
  const audit = (e: Omit<AuditEntry, "id">): void => { out.audit.push({ id: newId("aud"), ...e }); };

  /* ---------- sales ---------- */
  const POPULAR = ["kitfo", "beef-tibs", "beyaynetu", "shiro", "firfir", "buna", "macchiato", "soft-drink", "beer", "doro-wat", "spiced-tea", "water"];
  const weighted = MENU.flatMap((m) => (POPULAR.includes(m.id) ? [m, m, m] : [m]));
  const METHODS: PaymentMethod[] = ["CASH", "CASH", "CASH", "CASH", "TELEBIRR", "TELEBIRR", "TELEBIRR", "CBE_BIRR", "CBE_BIRR"];
  let ticket = 52_000;

  for (let back = 29; back >= 0; back--) {
    const day = addDays(now, -back);
    const tickets = between(55, 85);
    for (let k = 0; k < tickets; k++) {
      const hour = r() < 0.55 ? between(7, 14) : between(15, 21);
      const ts = stamp(day, hour, between(0, 59));
      if (!past(ts)) continue;
      const no = `T-${++ticket}`;
      const method = pick(METHODS);
      const shift = shiftOf(ts);
      const by = shift === "MORNING" ? (back % 2 ? "SS-104" : "SS-122") : "SS-117";
      for (let n = between(1, 3); n > 0; n--) {
        const m = pick(weighted);
        const qty = m.category === "HOT_DRINKS" || m.category === "COLD_DRINKS" || m.category === "BAR" ? between(1, 3) : between(1, 2);
        out.sales.push({ id: newId("sl"), ticketNo: no, menuItemId: m.id, quantity: qty, unitPrice: m.price, total: qty * m.price, paymentMethod: method, shift, loggedBy: by, timestamp: ts });
      }
    }
  }

  /* ---------- COGS purchases (clerk enters, manager reviews) ---------- */
  const VENDORS: Record<string, string> = {
    RAW_INGREDIENTS: "Merkato Fresh Produce", BEVERAGE_BAR: "Ethio Beverage Distributors", PACKAGING_DISPOSABLES: "Addis Packaging PLC",
    KITCHEN_CONSUMABLES: "Bole Kitchen Supply", CLEANING_SANITATION: "Sheger Cleaning Supplies",
  };
  const ROUTINE = ["onion", "tomato", "injera", "beef", "eggs", "coffee", "soft-drinks", "oil", "teff", "chicken", "beer", "berbere", "takeout-box", "napkins", "dish-soap", "plastic-wrap", "lentils", "kibbeh", "water", "trash-liners"];
  const buy = (day: string, hour: number, id: string, status: CogsPurchase["status"], decided?: string): void => {
    const it = item(id);
    const qty = Math.max(1, Math.round(it.reorderPoint * (0.6 + r() * 1.2)));
    const unitCost = round2(it.unitCost * (0.95 + r() * 0.12));
    const ts = stamp(day, hour, between(0, 59));
    if (!past(ts)) return;
    const p: CogsPurchase = {
      id: newId("pur"), itemId: id, category: it.category, quantity: qty, unit: it.unit, unitCost, totalCost: round2(qty * unitCost),
      vendor: VENDORS[it.category], paymentMethod: pick(["CASH", "TELEBIRR", "CBE_BIRR"] as const), loggedBy: CLERK, timestamp: ts, status,
    };
    if (status !== "PENDING") {
      p.reviewedBy = MANAGER;
      p.reviewedAt = decided ?? new Date(new Date(ts).getTime() + between(20, 140) * 60_000).toISOString();
      if (status === "FLAGGED") p.flagReason = pick(["Price higher than last week", "Receipt missing", "Quantity does not match delivery note"]);
      audit({ action: status === "APPROVED" ? "APPROVE_PURCHASE" : "FLAG_PURCHASE", itemKey: it.nameKey, quantity: qty, unit: it.unit, amount: p.totalCost, text: p.flagReason, userId: MANAGER, timestamp: p.reviewedAt });
    }
    out.purchases.push(p);
  };
  for (let back = 29; back >= 1; back--) {
    const day = addDays(now, -back);
    for (let k = between(3, 5); k > 0; k--) buy(day, between(7, 11), pick(ROUTINE), r() < 0.06 ? "FLAGGED" : "APPROVED");
  }
  // today: some already reviewed, a few still waiting
  buy(now, 7, "injera", "APPROVED", minsAgo(Math.min(400, Math.max(5, (nowMs - new Date(stamp(now, 8)).getTime()) / 60_000))));
  for (const id of ["onion", "beef", "soft-drinks", "napkins"]) {
    const it = item(id);
    const qty = Math.max(1, Math.round(it.reorderPoint * 1.1));
    const unitCost = round2(it.unitCost * 1.03);
    out.purchases.push({
      id: newId("pur"), itemId: id, category: it.category, quantity: qty, unit: it.unit, unitCost, totalCost: round2(qty * unitCost),
      vendor: VENDORS[it.category], paymentMethod: pick(["CASH", "TELEBIRR", "CBE_BIRR"] as const), loggedBy: CLERK, timestamp: minsAgo(between(25, 180)), status: "PENDING",
    });
  }

  /* ---------- dispatch requests from the Sales Department ---------- */
  const DISPATCH: [string, Destination, number, number][] = [
    ["soft-drinks", "BAR", 2, 4], ["beer", "BAR", 2, 5], ["water", "BAR", 2, 6], ["injera", "CATERING", 40, 120],
    ["takeout-box", "TAKEAWAY_COUNTER", 2, 6], ["cups-lids", "TAKEAWAY_COUNTER", 2, 4], ["coffee", "KITCHEN_LINE", 1, 3],
    ["beef", "BRANCH_PIASSA", 5, 15], ["tej", "EVENT_HALL", 10, 30], ["napkins", "EVENT_HALL", 3, 8], ["ice", "BAR", 3, 8],
  ];
  const request = (ts: string, decided: boolean): void => {
    const [id, dest, lo, hi] = pick(DISPATCH);
    const it = item(id);
    const d: DispatchRecord = {
      id: newId("dsp"), itemId: id, itemName: it.nameKey, quantity: between(lo, hi), unit: it.unit, requestedBy: pick(SALES),
      status: "PENDING", timestamp: ts, destination: dest,
    };
    if (decided) {
      const reject = r() < 0.12;
      d.status = reject ? "REJECTED" : "APPROVED";
      d.approvedBy = MANAGER;
      d.decidedAt = new Date(new Date(ts).getTime() + between(4, 40) * 60_000).toISOString();
      if (reject) d.rejectionReason = pick(["Not enough stock", "Duplicate request", "Quantity too high for this destination"]);
      audit({ action: reject ? "REJECT_DISPATCH" : "APPROVE_DISPATCH", itemKey: it.nameKey, quantity: d.quantity, unit: it.unit, destination: dest, text: d.rejectionReason, userId: MANAGER, timestamp: d.decidedAt });
    }
    out.dispatches.push(d);
  };
  for (let back = 14; back >= 1; back--) {
    const day = addDays(now, -back);
    for (let k = between(3, 6); k > 0; k--) request(stamp(day, between(8, 20), between(0, 59)), true);
  }
  for (let k = 0; k < 3; k++) { const ts = minsAgo(between(200, 420)); request(ts, true); }
  // waiting right now
  const pending: [string, Destination, number, string, number][] = [
    ["soft-drinks", "BAR", 3, "SS-117", 4], ["injera", "CATERING", 80, "SS-104", 11], ["takeout-box", "TAKEAWAY_COUNTER", 6, "SS-122", 19],
    ["beer", "EVENT_HALL", 4, "SS-117", 27], ["coffee", "KITCHEN_LINE", 2, "SS-104", 42],
  ];
  for (const [id, dest, qty, by, mins] of pending) {
    const it = item(id);
    out.dispatches.push({ id: newId("dsp"), itemId: id, itemName: it.nameKey, quantity: qty, unit: it.unit, requestedBy: by, status: "PENDING", timestamp: minsAgo(mins), destination: dest });
  }

  /* ---------- waste & shrinkage ---------- */
  const WASTE_POOL: [string, WasteReason, number, number][] = [
    ["tomato", "SPOILAGE", 1, 4], ["onion", "TRIM_LOSS", 1, 3], ["beef", "TRIM_LOSS", 0.5, 2], ["milk", "EXPIRED_STOCK", 1, 4],
    ["injera", "PREP_WASTE", 4, 15], ["soft-drinks", "DROPPED_ITEMS", 1, 1], ["kibbeh", "OVER_PORTIONING", 0.3, 1], ["eggs", "DROPPED_ITEMS", 3, 10],
    ["collard", "SPOILAGE", 1, 3], ["fish", "EXPIRED_STOCK", 1, 2], ["chicken", "PREP_WASTE", 1, 2],
  ];
  const wasteLog = (ts: string, reason?: WasteReason, idOverride?: string, qtyOverride?: number, note?: string, reporter?: string): void => {
    const [pid, preason, lo, hi] = pick(WASTE_POOL);
    const id = idOverride ?? pid;
    const it = item(id);
    const qty = qtyOverride ?? Math.round((lo + r() * (hi - lo)) * 10) / 10;
    const by = r() < 0.5 ? MANAGER : CLERK;
    const w: WasteLog = {
      id: newId("wst"), itemId: id, itemName: it.nameKey, quantityLost: qty, unit: it.unit, lossValue: round2(qty * it.unitCost),
      reason: reason ?? preason, customNotes: note, reportedBy: reporter ?? pick([CLERK, ...SALES]), loggedBy: by, timestamp: ts,
    };
    out.waste.push(w);
    audit({ action: "LOG_WASTE", itemKey: it.nameKey, quantity: qty, unit: it.unit, amount: w.lossValue, userId: by, timestamp: ts });
  };
  for (let back = 29; back >= 1; back--) {
    const day = addDays(now, -back);
    for (let k = between(0, 2); k > 0; k--) wasteLog(stamp(day, between(9, 21), between(0, 59)));
  }
  wasteLog(addDays(now, -6) + "T19:30:00", "INVENTORY_THEFT", "beer", 1, "Crate missing after night shift; reported to security", CLERK);
  const todayWaste = minsAgo(between(60, 240));
  if (localToday(todayWaste, now)) wasteLog(todayWaste, "SPOILAGE", "tomato", 3, undefined, "SS-104");

  /* ---------- petty cash & misc expenses ---------- */
  const EXP: [string, number, number, ExpenseSource][] = [
    ["Gas cylinder refill", 900, 1400, "PETTY_CASH"], ["Generator fuel", 1200, 2600, "PETTY_CASH"], ["Taxi / ride for delivery", 150, 400, "TELEBIRR"],
    ["Plumber call-out", 600, 1500, "CASH"], ["Emergency market run", 300, 900, "PETTY_CASH"], ["Printer paper & receipt rolls", 250, 600, "CBE_BIRR"],
  ];
  for (let back = 29; back >= 0; back--) {
    if (r() > 0.45) continue;
    const day = addDays(now, -back);
    const ts = stamp(day, between(9, 19), between(0, 59));
    if (!past(ts)) continue;
    const [reason, lo, hi, src] = pick(EXP);
    const by = r() < 0.6 ? MANAGER : CLERK;
    const e: ExpenseRecord = { id: newId("exp"), reason, amount: between(lo, hi), source: src, note: "", loggedBy: by, timestamp: ts };
    out.expenses.push(e);
    audit({ action: "LOG_EXPENSE", text: reason, amount: e.amount, userId: by, timestamp: ts });
  }

  out.audit.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return out;
}

function localToday(iso: string, day: string): boolean {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === day;
}
