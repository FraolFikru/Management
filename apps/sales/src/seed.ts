/* =========================================================
   Generated sample purchasing history (~8 weeks, relative to today)
   for Bistro Addis. Deterministic, so numbers are stable on reload.
   Every record is stamped with the staff member who made it,
   and each one has a matching audit entry.
   ========================================================= */

import type {
  AuditEntry, CustomExpenseRecord, ExpensePaymentMethod, ExpenseTag, PurchaseRecord,
  StaffAccount, WasteReason, WasteRecord,
} from "./types";
import { BASE_INVENTORY, STAFF } from "./catalog";
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

const staff = (id: string): StaffAccount => {
  const s = STAFF.find((x) => x.userId === id);
  if (!s) throw new Error(id);
  return s;
};

export interface SeedData {
  purchases: PurchaseRecord[];
  waste: WasteRecord[];
  expenses: CustomExpenseRecord[];
  audit: AuditEntry[];
}

export function generateSeed(): SeedData {
  const r = rng(20261106);
  const now = today();
  const out: SeedData = { purchases: [], waste: [], expenses: [], audit: [] };
  const between = (a: number, b: number): number => Math.round(a + r() * (b - a));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const nowMs = Date.now();

  const audit = (e: Omit<AuditEntry, "id" | "userName" | "role">, by: StaffAccount): void => {
    out.audit.push({ ...e, id: newId("aud"), userName: by.name, role: by.role });
  };

  const inv = (id: string) => {
    const it = BASE_INVENTORY.find((x) => x.id === id);
    if (!it) throw new Error(id);
    return it;
  };

  const buy = (day: string, id: string, qty: number, vendor: string, method: ExpensePaymentMethod, hour = 9): void => {
    const it = inv(id);
    const by = r() < 0.8 ? staff("u-dawit") : staff("u-hanna");
    const unitCost = it.unitCost >= 20 ? Math.round(it.unitCost * (0.95 + r() * 0.1)) : round2(it.unitCost * (0.95 + r() * 0.1));
    const ts = stamp(day, hour, between(0, 59));
    if (new Date(ts).getTime() > nowMs) return;
    const rec: PurchaseRecord = {
      id: newId("pur"), category: it.category, itemName: it.nameKey, quantity: qty, unit: it.unit, unitCost,
      totalCost: round2(qty * unitCost), loggedBy: by.name, timestamp: ts, itemId: it.id, vendor, paymentMethod: method, userId: by.userId, note: "",
    };
    out.purchases.push(rec);
    audit({ action: "CREATE", entity: "PURCHASE", entityId: rec.id, summary: `Purchase ${it.id}`, detail: { name: it.nameKey, amount: rec.totalCost, quantity: qty, unit: it.unit }, userId: by.userId, timestamp: ts }, by);
  };

  const waste = (day: string, id: string, qty: number, reason: WasteReason, reporter: StaffAccount, notes = "", approve: boolean | null = true): void => {
    const it = inv(id);
    const ts = stamp(day, between(14, 22), between(0, 59));
    if (new Date(ts).getTime() > nowMs) return;
    const rec: WasteRecord = {
      id: newId("wst"), itemId: it.id, itemName: it.nameKey, quantityLost: qty, unit: it.unit, unitCost: it.unitCost,
      lossValue: round2(qty * it.unitCost), reason, customNotes: notes || undefined, reportedBy: reporter.name, timestamp: ts,
      userId: reporter.userId, approval: approve === null ? "PENDING" : approve ? "APPROVED" : "REJECTED",
      approvedBy: approve === null ? null : "Hanna Tesfaye", approvedAt: approve === null ? null : stamp(day, 23),
    };
    out.waste.push(rec);
    audit({ action: "CREATE", entity: "WASTE", entityId: rec.id, summary: `Waste ${it.id}`, detail: { name: it.nameKey, amount: rec.lossValue, quantity: qty, unit: it.unit }, userId: reporter.userId, timestamp: ts }, reporter);
    if (approve !== null) {
      audit({ action: approve ? "APPROVE" : "REJECT", entity: "WASTE", entityId: rec.id, summary: `Waste ${it.id}`, detail: { name: it.nameKey, amount: rec.lossValue }, userId: "u-hanna", timestamp: rec.approvedAt ?? ts }, staff("u-hanna"));
    }
  };

  const expense = (day: string, reason: string, tag: ExpenseTag, amount: number, method: ExpensePaymentMethod, byId = "u-hanna", note = ""): void => {
    const by = staff(byId);
    const ts = stamp(day, between(10, 17), between(0, 59));
    if (new Date(ts).getTime() > nowMs) return;
    const rec: CustomExpenseRecord = { id: newId("exp"), reason, tag, amount, paymentMethod: method, note, loggedBy: by.name, userId: by.userId, timestamp: ts };
    out.expenses.push(rec);
    audit({ action: "CREATE", entity: "EXPENSE", entityId: rec.id, summary: reason, detail: { name: reason, amount }, userId: by.userId, timestamp: ts }, by);
  };

  for (let back = 55; back >= 0; back--) {
    const day = addDays(now, -back);


    // purchases (COGS)
    const produce = back % 2 ? "Merkato Fresh Produce" : "Shola Vegetables";
    buy(day, "injera", between(110, 150), "Alem Injera Bakery", "CASH", 7);
    buy(day, "onion", between(8, 14), produce, pick(["CASH", "TELEBIRR"] as const), 8);
    buy(day, "tomato", between(6, 10), produce, pick(["CASH", "TELEBIRR"] as const), 8);
    if (back % 2 === 0) { buy(day, "green-pepper", between(3, 5), produce, "CASH", 8); buy(day, "collard", between(6, 9), produce, "CASH", 8); }
    if (back % 2 === 1) buy(day, "beef", between(10, 15), "Kaliti Meat Supply", "CBE_BIRR");
    if (back % 3 === 0) {
      buy(day, "chicken", between(6, 10), "Kaliti Meat Supply", "CBE_BIRR");
      buy(day, "eggs", 90, "Sheger Dairy", "CASH");
      buy(day, "kibbeh", between(2, 3), "Sheger Dairy", "TELEBIRR");
      buy(day, "ayib", 3, "Sheger Dairy", "CASH");
    }
    if (back % 4 === 1) { buy(day, "lamb", between(4, 6), "Kaliti Meat Supply", "CBE_BIRR"); buy(day, "fish", 3, "Ziway Fish Market", "TELEBIRR"); }
    if (back % 7 === 1) {
      buy(day, "berbere", 3, "Habesha Grain Store", "CBE_BIRR");
      buy(day, "shiro", 6, "Habesha Grain Store", "CBE_BIRR");
      buy(day, "lentils", 10, "Habesha Grain Store", "CBE_BIRR");
      buy(day, "oil", 10, "Habesha Grain Store", "CBE_BIRR");
      buy(day, "mitmita", 1, "Habesha Grain Store", "CBE_BIRR");
    }
    if (back % 7 === 4) {
      buy(day, "soft-drinks", 5, "Bole Beverage Distributors", "CBE_BIRR");
      buy(day, "beer", 6, "Bole Beverage Distributors", "CBE_BIRR");
      buy(day, "water", 4, "Bole Beverage Distributors", "CASH");
      buy(day, "coffee", 5, "Yirga Coffee Roasters", "TELEBIRR");
      buy(day, "tea", 1, "Yirga Coffee Roasters", "TELEBIRR");
    }
    if (back % 10 === 5) {
      buy(day, "takeout-box", 3, "Addis Packaging", "CASH");
      buy(day, "cups-lids", 2, "Addis Packaging", "CASH");
      buy(day, "napkins", 3, "Addis Packaging", "CASH");
      buy(day, "plastic-wrap", 2, "Addis Packaging", "CASH");
      buy(day, "foil-roll", 2, "Addis Packaging", "CASH");
    }
    if (back % 6 === 2) {
      buy(day, "dish-soap", 5, "Addis Packaging", "CASH");
      buy(day, "surface-sanitizer", 4, "Addis Packaging", "CASH");
      buy(day, "trash-liners", 3, "Addis Packaging", "CASH");
    }
    if (back % 14 === 3) { buy(day, "degreaser", 5, "Addis Packaging", "CASH"); buy(day, "mops", 2, "Addis Packaging", "CASH"); buy(day, "food-sanitizer", 4, "Addis Packaging", "CASH"); }

    // waste & shrinkage
    if (back % 2 === 0) waste(day, "tomato", between(1, 2), "SPOILAGE", staff("u-dawit"), "", back <= 1 ? null : true);
    if (back % 3 === 1) waste(day, "onion", 1, "TRIM_LOSS", staff("u-dawit"), "", back <= 1 ? null : true);
    if (back % 4 === 2) waste(day, "injera", between(4, 9), "PREP_WASTE", staff("u-dawit"), "", back <= 2 ? null : true);
    if (back % 5 === 0) waste(day, "beef", 0.5, "OVER_PORTIONING", staff("u-hanna"), "Kitfo portions too large on busy shift", back <= 3 ? null : true);
    if (back % 9 === 4) waste(day, "soft-drinks", 0.25, "DROPPED_ITEMS", staff("u-dawit"), "", true);
    if (back % 11 === 6) waste(day, "milk", 3, "EXPIRED_STOCK", staff("u-dawit"), "", true);
    if (back === 19) waste(day, "beer", 0.5, "INVENTORY_THEFT", staff("u-dawit"), "Half a crate missing at weekly count", true);
    if (back === 8) waste(day, "kibbeh", 0.5, "OTHER", staff("u-hanna"), "Burned while clarifying", false);

    // custom expenses ("other reasons")
    if (back % 7 === 0) expense(day, "Generator fuel", "UTILITIES", between(1200, 1800), "CASH", "u-hanna");
    if (back % 10 === 3) expense(day, "Bajaj delivery to catering client", "TRANSPORT", between(250, 400), "CASH", "u-dawit");
    if (back === 21) expense(day, "Fridge compressor repair", "MAINTENANCE", 4800, "CBE_BIRR", "u-abebe", "Abebe Cooling Service, receipt #2210");
    if (back === 12) expense(day, "Staff coffee ceremony supplies", "STAFF_WELFARE", 650, "CASH", "u-hanna");
    if (back === 9) expense(day, "Printed menu flyers", "MARKETING", 1500, "TELEBIRR", "u-hanna");
    if (back === 30) expense(day, "Health permit renewal", "LICENSES_FEES", 1200, "CBE_BIRR", "u-abebe");
    if (back === 5) expense(day, "Receipt paper rolls", "OFFICE_ADMIN", 360, "CASH", "u-dawit");
    if (back === 2) expense(day, "Plumber for kitchen sink", "MAINTENANCE", 900, "CASH", "u-hanna", "Blocked drain");
  }

  // sign-in trail for the last few days
  for (let back = 3; back >= 0; back--) {
    const day = addDays(now, -back);
    for (const [uid, h] of [["u-dawit", 7], ["u-hanna", 9]] as const) {
      const ts = stamp(day, h, 2);
      if (new Date(ts).getTime() <= nowMs) audit({ action: "SIGN_IN", entity: "SESSION", entityId: uid, summary: "Signed in", detail: {}, userId: uid, timestamp: ts }, staff(uid));
    }
  }

  out.audit.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return out;
}
