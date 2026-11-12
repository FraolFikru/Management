/* =========================================================
   Fixed lists: roles, permissions (and the rules that lock them),
   menu items, payment methods. Names are LocalizedText registered
   for tk(): role.X, menu.X, pay.X.
   ========================================================= */

import type { LocalizedText, PaymentMethod, PermissionKey, RolePermissions, UserRole } from "./types";
import { registerText } from "./i18n";

function reg<K extends string>(prefix: string, map: Record<K, LocalizedText>): Record<K, LocalizedText> {
  for (const k of Object.keys(map) as K[]) registerText(`${prefix}.${k}`, map[k]);
  return map;
}

export const VAT_RATE = 15;

/* ---------- roles ---------- */

export const ROLES = reg<UserRole>("role", {
  ADMIN: { en: "System Admin", am: "የሲስተም አስተዳዳሪ", om: "Bulchaa sirnaa" },
  BRANCH_MANAGER: { en: "Branch Manager", am: "የቅርንጫፍ ሥራ አስኪያጅ", om: "Hoji-gaggeessaa Damee" },
  SALES_STAFF: { en: "Cashier", am: "ገንዘብ ተቀባይ", om: "Kaffaltii fudhataa" },
  WAITER: { en: "Waiter", am: "አስተናጋጅ", om: "Keessummeessaa" },
  KITCHEN_STAFF: { en: "Kitchen Staff", am: "የወጥ ቤት ሰራተኛ", om: "Hojjetaa Kushinaa" },
  INVENTORY_CLERK: { en: "Inventory Clerk", am: "የንብረት ጸሐፊ", om: "Barreessaa Kuusaa" },
  ACCOUNTANT: { en: "Accountant", am: "የሂሳብ ባለሙያ", om: "Herrega-qabaa" },
  HR_OFFICER: { en: "HR Officer", am: "የሰው ኃይል ባለሙያ", om: "Ogeessa Humna Namaa" },
  OWNER: { en: "Owner", am: "ባለቤት", om: "Abbaa Qabeenyaa" },
});
export const ROLE_IDS = Object.keys(ROLES) as UserRole[];

/** Which apps each role signs in to (shown under the role in the user form). */
export const ROLE_APPS: Record<UserRole, string> = {
  ADMIN: "All apps",
  BRANCH_MANAGER: "Manager · Cashier · Waiter · Kitchen display",
  SALES_STAFF: "Cashier app · takes table payments",
  WAITER: "Waiter app (tables, no cash)",
  KITCHEN_STAFF: "Kitchen display",
  INVENTORY_CLERK: "Purchases & stock",
  ACCOUNTANT: "Finance",
  HR_OFFICER: "HR & staff",
  OWNER: "Owner dashboard",
};
/** Only the Owner creates or changes these accounts (the Owner app and the server enforce it too). */
export const PROTECTED_ROLES: readonly UserRole[] = ["OWNER", "ADMIN"];
export const isRole = (v: unknown): v is UserRole => typeof v === "string" && v in ROLES;

/* ---------- permissions ---------- */

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  hint: string;
  group: "Daily work" | "Money & prices" | "System";
}

export const PERMISSIONS: readonly PermissionMeta[] = [
  { key: "canMakeSales", label: "Make sales", hint: "Ring up orders at the register", group: "Daily work" },
  { key: "canRequestDispatch", label: "Request dispatch", hint: "Ask the store room for stock", group: "Daily work" },
  { key: "canApproveDispatch", label: "Approve dispatch", hint: "Release stock from the store room", group: "Daily work" },
  { key: "canLogWaste", label: "Log waste", hint: "Record spoiled or wasted stock", group: "Daily work" },
  { key: "canViewReports", label: "View financial reports", hint: "P&L, sales and cost reports", group: "Money & prices" },
  { key: "canLogExpenses", label: "Log custom expenses", hint: "Record spending outside purchase orders", group: "Money & prices" },
  { key: "canEditPrices", label: "Edit price book", hint: "Change menu prices", group: "Money & prices" },
  { key: "canOverrideInventory", label: "Override inventory", hint: "Change stock counts by hand", group: "Money & prices" },
  { key: "canAccessAdmin", label: "System admin", hint: "This settings area", group: "System" },
];

/** Reports, expenses, prices and stock overrides: Branch Managers, office roles and Admins only. */
export const RESTRICTED: readonly PermissionKey[] = ["canViewReports", "canLogExpenses", "canEditPrices", "canOverrideInventory"];
/** Roles that may hold RESTRICTED permissions (besides Admin). */
const TRUSTED: readonly UserRole[] = ["BRANCH_MANAGER", "ACCOUNTANT", "OWNER"];
/** What a Cashier may ever have. */
export const SALES_ALLOWED: readonly PermissionKey[] = ["canMakeSales", "canRequestDispatch"];

/** Why a cell cannot be changed, or null when it can. The value of a locked cell is fixed (see lockedValue). */
export function lockReason(role: UserRole, key: PermissionKey): string | null {
  if (role === "ADMIN") return "Admins always have every permission.";
  if (key === "canAccessAdmin") return "Only the Owner and System Admins can open System admin.";
  if (role === "SALES_STAFF" && !SALES_ALLOWED.includes(key)) return "Cashiers can only make sales and request dispatch.";
  if (RESTRICTED.includes(key) && !TRUSTED.includes(role)) return "Only Branch Managers, Accountants, Owners and Admins.";
  return null;
}
export const lockedValue = (role: UserRole): boolean => role === "ADMIN";

const all = (v: boolean): Omit<RolePermissions, "role"> => ({
  canViewReports: v, canApproveDispatch: v, canEditPrices: v, canLogWaste: v, canAccessAdmin: v,
  canMakeSales: v, canRequestDispatch: v, canLogExpenses: v, canOverrideInventory: v,
});

export const DEFAULT_PERMISSIONS: RolePermissions[] = [
  { role: "ADMIN", ...all(true) },
  { role: "BRANCH_MANAGER", ...all(true), canAccessAdmin: false },
  { role: "SALES_STAFF", ...all(false), canMakeSales: true, canRequestDispatch: true },
  { role: "WAITER", ...all(false), canMakeSales: true },
  { role: "KITCHEN_STAFF", ...all(false), canRequestDispatch: true, canLogWaste: true },
  { role: "INVENTORY_CLERK", ...all(false), canApproveDispatch: true, canLogWaste: true, canRequestDispatch: true },
  { role: "ACCOUNTANT", ...all(false), canViewReports: true },
  { role: "HR_OFFICER", ...all(false) },
  { role: "OWNER", ...all(false), canViewReports: true },
];

/* ---------- menu (master price book) ---------- */

export const MENU = reg("menu", {
  DORO_WAT: { en: "Doro Wat", am: "ዶሮ ወጥ", om: "Ittoo Lukkuu" },
  SPECIAL_TIBS: { en: "Special Tibs", am: "ስፔሻል ጥብስ", om: "Tibsii Addaa" },
  KITFO: { en: "Kitfo", am: "ክትፎ", om: "Kitfoo" },
  SHIRO: { en: "Shiro Tegabino", am: "ሽሮ ተጋቢኖ", om: "Shiroo Tegaabinoo" },
  BEYAYNETU: { en: "Beyaynetu (fasting platter)", am: "በያይነቱ", om: "Bayaaynatuu (soomaa)" },
  FIRFIR: { en: "Firfir", am: "ፍርፍር", om: "Firfir" },
  MACCHIATO: { en: "Macchiato", am: "ማኪያቶ", om: "Maakiyaatoo" },
  BUNNA: { en: "Traditional coffee (jebena)", am: "ጀበና ቡና", om: "Buna jabanaa" },
  AMBO: { en: "Ambo mineral water", am: "አምቦ ውሃ", om: "Bishaan Amboo" },
  JUICE: { en: "Fresh avocado juice", am: "የአቮካዶ ጭማቂ", om: "Cuunfaa avookaadoo" },
});

/* ---------- payment methods ---------- */

export const METHODS = reg<PaymentMethod>("pay", {
  CASH: { en: "Cash", am: "ጥሬ ገንዘብ", om: "Callaa" },
  TELEBIRR: { en: "Telebirr", am: "ቴሌብር", om: "Telebirr" },
  CBE_BIRR: { en: "CBE Birr", am: "ሲቢኢ ብር", om: "CBE Birr" },
});
export const METHOD_IDS = Object.keys(METHODS) as PaymentMethod[];
