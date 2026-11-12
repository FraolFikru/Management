/* Demo data: store profile, three Addis Ababa branches, staff accounts,
   default permissions, receipt layout, the master price book, two weeks
   of activity log and 90 days of sales transactions (for export). */

import type { AuditEntry, AuditKind, Branch, MenuPrice, PaymentMethod, ReceiptConfig, RolePermissions, StoreProfile, Transaction, UserAccount } from "./types";
import { DEFAULT_PERMISSIONS, MENU } from "./catalog";
import { addDays, round2, stamp, today } from "./format";

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

function rng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

export const PROFILE: StoreProfile = {
  id: "STORE-01",
  businessName: "SEER Restaurant PLC",
  branchName: "Bole Branch",
  tinNumber: "0045871236",
  vatNumber: "VAT-1187654",
  address: "Bole Road, near Edna Mall, Addis Ababa",
  phone: "+251 911 234 567",
  currency: "ETB",
  vatRate: 15,
  isVatEnabled: true,
  licenseNumber: "AA/BL/14/678/2016",
  currencySymbol: "ETB",
};

export const BRANCHES: Branch[] = [
  { id: "BR-BOLE", name: "Bole Branch", code: "BOL", address: "Bole Road, near Edna Mall", phone: "+251 911 234 567", managerId: "U-002", isActive: true, openedOn: "2019-03-11" },
  { id: "BR-KAZ", name: "Kazanchis Branch", code: "KAZ", address: "Kazanchis, behind Intercontinental Hotel", phone: "+251 911 345 678", managerId: "U-003", isActive: true, openedOn: "2021-07-08" },
  { id: "BR-PIA", name: "Piassa Branch", code: "PIA", address: "Piassa, Cunningham Street", phone: "+251 911 456 789", managerId: "U-004", isActive: true, openedOn: "2023-01-16" },
];

export const USERS: UserAccount[] = [
  { id: "U-001", fullName: "Selam Girma", username: "selam.g", role: "ADMIN", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 001" },
  { id: "U-002", fullName: "Hanna Tesfaye", username: "hanna.t", role: "BRANCH_MANAGER", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 002" },
  { id: "U-003", fullName: "Yonas Bekele", username: "yonas.b", role: "BRANCH_MANAGER", assignedBranchId: "BR-KAZ", isActive: true, phone: "+251 911 100 003" },
  { id: "U-004", fullName: "Meron Haile", username: "meron.h", role: "BRANCH_MANAGER", assignedBranchId: "BR-PIA", isActive: true, phone: "+251 911 100 004" },
  { id: "U-005", fullName: "Dawit Alemu", username: "dawit.a", role: "SALES_STAFF", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 005" },
  { id: "U-006", fullName: "Liya Mekonnen", username: "liya.m", role: "SALES_STAFF", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 006" },
  { id: "U-007", fullName: "Abdi Hussein", username: "abdi.h", role: "SALES_STAFF", assignedBranchId: "BR-KAZ", isActive: true, phone: "+251 911 100 007" },
  { id: "U-008", fullName: "Chaltu Gemechu", username: "chaltu.g", role: "SALES_STAFF", assignedBranchId: "BR-PIA", isActive: true, phone: "+251 911 100 008" },
  { id: "U-009", fullName: "Tsehay Wolde", username: "tsehay.w", role: "KITCHEN_STAFF", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 009" },
  { id: "U-010", fullName: "Biruk Tadesse", username: "biruk.t", role: "KITCHEN_STAFF", assignedBranchId: "BR-KAZ", isActive: true, phone: "+251 911 100 010" },
  { id: "U-011", fullName: "Kebede Asfaw", username: "kebede.a", role: "INVENTORY_CLERK", assignedBranchId: "BR-BOLE", isActive: true, phone: "+251 911 100 011" },
  { id: "U-012", fullName: "Rahel Getachew", username: "rahel.g", role: "SALES_STAFF", assignedBranchId: "BR-KAZ", isActive: false, phone: "+251 911 100 012" },
];

export const PERMISSIONS_SEED: RolePermissions[] = DEFAULT_PERMISSIONS.map((p) => ({ ...p }));

export const RECEIPT: ReceiptConfig = {
  paperWidthMm: 80,
  headerMessage: "Welcome to SEER\nእንኳን ደህና መጡ",
  footerMessage: "Thank you for dining with us!\nAmesegenalehu! / Galatoomaa!",
  showTinOnReceipt: true,
  showVatBreakdown: true,
  printerName: "Epson TM-T20III (front counter)",
  connection: "LAN",
  printerIp: "192.168.1.50",
};

const PRICES: Record<keyof typeof MENU, [MenuPrice["category"], number, Record<string, number>]> = {
  DORO_WAT: ["FOOD", 650, { "BR-BOLE": 720 }],
  SPECIAL_TIBS: ["FOOD", 580, { "BR-BOLE": 640 }],
  KITFO: ["FOOD", 620, {}],
  SHIRO: ["FOOD", 220, { "BR-PIA": 200 }],
  BEYAYNETU: ["FOOD", 260, {}],
  FIRFIR: ["FOOD", 180, {}],
  MACCHIATO: ["DRINK", 60, { "BR-BOLE": 70 }],
  BUNNA: ["DRINK", 45, {}],
  AMBO: ["DRINK", 50, {}],
  JUICE: ["DRINK", 120, {}],
};
export const MENU_PRICES: MenuPrice[] = (Object.keys(PRICES) as (keyof typeof MENU)[]).map((id) => ({
  id, category: PRICES[id][0], basePrice: PRICES[id][1], overrides: { ...PRICES[id][2] },
}));

/* ---------- activity log ---------- */

export function generateAudit(): AuditEntry[] {
  const r = rng(11);
  const out: AuditEntry[] = [];
  const add = (day: string, h: number, m: number, userId: string, branchId: string, kind: AuditKind, text: string, vars: AuditEntry["vars"] = {}): void => {
    out.push({ id: `A-${out.length + 1}`, at: stamp(day, h, m), userId, branchId, kind, text, vars });
  };
  for (let i = 14; i >= 1; i--) {
    const day = addDays(today(), -i);
    for (const u of USERS.filter((x) => x.isActive)) {
      if (r() < 0.55) add(day, 7 + Math.floor(r() * 3), Math.floor(r() * 60), u.id, u.assignedBranchId, "LOGIN", "Signed in");
    }
    if (r() < 0.25) add(day, 9, 12, "U-011", "BR-BOLE", "INVENTORY", "Overrode stock count of {item}: {from} → {to}", { item: ["Teff flour (kg)", "Onions (kg)", "Berbere (kg)", "Niter kibbeh (kg)"][Math.floor(r() * 4)], from: 40 + Math.floor(r() * 20), to: 35 + Math.floor(r() * 20) });
    if (r() < 0.2) add(day, 10, 40, "U-003", "BR-KAZ", "INVENTORY", "Overrode stock count of {item}: {from} → {to}", { item: "Coffee beans (kg)", from: 18, to: 15 });
  }
  add(addDays(today(), -12), 11, 5, "U-001", "BR-BOLE", "PRICE", "Changed {item} price: {from} → {to} ({scope})", { item: "menu.DORO_WAT", from: 690, to: 720, scope: "Bole Branch" });
  add(addDays(today(), -9), 16, 20, "U-002", "BR-BOLE", "PRICE", "Changed {item} price: {from} → {to} ({scope})", { item: "menu.MACCHIATO", from: 65, to: 70, scope: "Bole Branch" });
  add(addDays(today(), -8), 8, 55, "U-001", "BR-BOLE", "ROLE", "{perm} turned {state} for {role}", { perm: "canLogWaste", state: "on", role: "role.KITCHEN_STAFF" });
  add(addDays(today(), -6), 14, 10, "U-001", "BR-KAZ", "USER", "Deactivated {name}", { name: "Rahel Getachew" });
  add(addDays(today(), -5), 9, 30, "U-001", "BR-BOLE", "SETTINGS", "Updated receipt layout");
  add(addDays(today(), -3), 17, 45, "U-001", "BR-BOLE", "EXPORT", "Exported {what} ({format}, {n} rows)", { what: "Transactions", format: "CSV", n: 2140 });
  add(addDays(today(), -2), 12, 0, "U-004", "BR-PIA", "PRICE", "Changed {item} price: {from} → {to} ({scope})", { item: "menu.SHIRO", from: 220, to: 200, scope: "Piassa Branch" });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/* ---------- sales transactions ---------- */

export function generateTransactions(): Transaction[] {
  const r = rng(29);
  const out: Transaction[] = [];
  const cashiers: Record<string, string[]> = { "BR-BOLE": ["U-005", "U-006"], "BR-KAZ": ["U-007"], "BR-PIA": ["U-008"] };
  const volume: Record<string, number> = { "BR-BOLE": 34, "BR-KAZ": 26, "BR-PIA": 20 };
  let no = 10000;
  for (let i = 90; i >= 1; i--) {
    const day = addDays(today(), -i);
    for (const b of BRANCHES) {
      const n = Math.round(volume[b.id] * (0.8 + r() * 0.4));
      for (let k = 0; k < n; k++) {
        const items = 1 + Math.floor(r() * 5);
        const subtotal = round2(items * (120 + r() * 420));
        const vat = round2(subtotal * 0.15);
        const roll = r();
        const method: PaymentMethod = roll < 0.5 ? "CASH" : roll < 0.82 ? "TELEBIRR" : "CBE_BIRR";
        const list = cashiers[b.id];
        out.push({
          id: `T-${++no}`, receiptNo: `${b.code}-${no}`, at: stamp(day, 8 + Math.floor((k / n) * 13), Math.floor(r() * 60)), branchId: b.id,
          cashierId: list[Math.floor(r() * list.length)], method, items, subtotal, vat, total: round2(subtotal + vat),
        });
      }
    }
  }
  return out;
}
