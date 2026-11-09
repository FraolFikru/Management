/* =========================================================
   Domain types for Bistro Ledger v3.
   The first block is the specification, unchanged; the second
   extends it for purchasing, custom expenses, approval and auditing.
   This app is for BUYING only: no sales are recorded here.
   ========================================================= */

export type SupportedLanguage = "en" | "am" | "om";

export type COGSCategory =
  | "RAW_INGREDIENTS"
  | "BEVERAGE_BAR"
  | "PACKAGING_DISPOSABLES"
  | "KITCHEN_CONSUMABLES"
  | "CLEANING_SANITATION";

export type WasteReason =
  | "PREP_WASTE"
  | "TRIM_LOSS"
  | "OVER_PORTIONING"
  | "DROPPED_ITEMS"
  | "SPOILAGE"
  | "EXPIRED_STOCK"
  | "INVENTORY_THEFT"
  | "OTHER";

export interface UserSession {
  userId: string;
  name: string;
  role: "SALES_STAFF" | "INVENTORY_CLERK" | "MANAGER" | "ADMIN";
}

export interface InventoryPurchaseRecord {
  id: string;
  category: COGSCategory;
  itemName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  loggedBy: string; // User Name / ID
  timestamp: string;
}

export interface WasteReportRecord {
  id: string;
  itemId: string;
  itemName: string;
  quantityLost: number;
  unit: string;
  lossValue: number;
  reason: WasteReason;
  customNotes?: string;
  reportedBy: string; // User Name / ID
  timestamp: string;
}

/* =========================================================
   Extensions
   ========================================================= */

export type Role = UserSession["role"];
/** How a purchase or expense was paid. */
export type ExpensePaymentMethod = "CASH" | "TELEBIRR" | "CBE_BIRR";
export type ThemeMode = "dark" | "light";
export type ViewId = "dashboard" | "purchases" | "waste" | "expenses" | "audit";
export type PeriodId = "today" | "7d" | "30d";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
/** What staff pick first when recording a purchase (e.g. Vegetables → Onion). Each maps to one COGS category. */
export type MainCategory =
  | "VEGETABLES"
  | "MEAT_FISH"
  | "DAIRY_EGGS"
  | "GRAINS_FLOUR"
  | "OIL"
  | "SPICES"
  | "DRINKS"
  | "COFFEE_TEA"
  | "PACKAGING"
  | "KITCHEN"
  | "CLEANING";

export type ExpenseTag =
  | "MAINTENANCE"
  | "TRANSPORT"
  | "UTILITIES"
  | "STAFF_WELFARE"
  | "MARKETING"
  | "OFFICE_ADMIN"
  | "LICENSES_FEES"
  | "OTHER";

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

/** A staff account that can sign in. `pin` is a demo stand-in for real authentication. */
export interface StaffAccount extends UserSession {
  initials: string;
  pin: string;
}

/** A stock item (what is BOUGHT, wasted or counted). */
export interface InventoryItem {
  id: string;
  nameKey: string;
  category: COGSCategory;
  /** main category shown in the picker, e.g. VEGETABLES */
  main: MainCategory;
  /** e.g. "Proteins", "Produce" — a translation key */
  groupKey: string;
  unit: string;
  /** last known cost per unit, used to value waste */
  unitCost: number;
  aliases: readonly string[];
  custom?: boolean;
}

/** Purchase record with the extra fields the UI needs. */
export interface PurchaseRecord extends InventoryPurchaseRecord {
  itemId: string;
  vendor: string;
  paymentMethod: ExpensePaymentMethod;
  userId: string;
  note: string;
}

export interface WasteRecord extends WasteReportRecord {
  /** cost of the lost stock per unit used for lossValue */
  unitCost: number;
  userId: string;
  approval: ApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface CustomExpenseRecord {
  id: string;
  reason: string;
  tag: ExpenseTag;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  note: string;
  loggedBy: string;
  userId: string;
  timestamp: string;
}

export type AuditAction = "SIGN_IN" | "SIGN_OUT" | "CREATE" | "DELETE" | "RESTORE" | "APPROVE" | "REJECT";
export type AuditEntity = "SESSION" | "PURCHASE" | "WASTE" | "EXPENSE" | "ITEM";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  /** human summary in English; the UI rebuilds a localized version from `detail` */
  summary: string;
  detail: { name?: string; amount?: number; quantity?: number; unit?: string };
  userId: string;
  userName: string;
  role: Role;
  timestamp: string;
}

export interface PeriodTotals {
  purchases: number;
  /** number of purchase entries */
  entries: number;
  waste: number;
  wastePending: number;
  expenses: number;
  /** purchases + other expenses */
  spent: number;
}

export type FieldErrors = Partial<Record<string, string>>;
