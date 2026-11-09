/* =========================================================
   Branch Manager Dashboard — domain types.
   Block 1 is the specification, unchanged.
   Block 2 extends it (documented) for stock levels, purchases
   under review, the dispatch queue and the audit trail.
   Sales and COGS purchases are separate record types and are
   never mixed in one list or one total.
   ========================================================= */

/* ---------- 1. Specification ---------- */

export type SupportedLanguage = "en" | "am" | "om";

export type UserRole = "BRANCH_MANAGER" | "SALES_STAFF" | "INVENTORY_CLERK" | "ADMIN";

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

/** Payment reconciliation covers exactly three local channels. */
export type PaymentMethod = "CASH" | "TELEBIRR" | "CBE_BIRR";

export interface UserSession {
  userId: string;
  name: string;
  role: UserRole;
  branchId: string;
}

export interface DispatchRequest {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  requestedBy: string; // Staff Name / ID
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason?: string;
  timestamp: string;
}

export interface WasteReportRecord {
  id: string;
  itemName: string;
  quantityLost: number;
  unit: string;
  lossValue: number;
  reason: WasteReason;
  customNotes?: string;
  reportedBy: string; // Staff Name / ID
  timestamp: string;
}

export interface PaymentSummary {
  cash: number;
  telebirr: number;
  cbeBirr: number;
  total: number;
}

/* ---------- 2. Extensions ---------- */

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

export type ViewId = "overview" | "sales" | "dispatch" | "cogs" | "waste" | "expenses" | "audit";
export type PeriodId = "today" | "7d" | "30d";
export type Shift = "MORNING" | "EVENING";

/** Staff directory entry. `userId` doubles as the printed staff ID (e.g. "SS-104"). */
export interface StaffAccount extends UserSession {
  initials: string;
}

/* --- sales (pure: what customers bought) --- */

export type MenuCategory = "MAINS" | "FASTING" | "BREAKFAST" | "HOT_DRINKS" | "COLD_DRINKS" | "BAR";

export interface MenuItem {
  id: string;
  nameKey: string;
  category: MenuCategory;
  price: number;
}

/** One line of a completed customer sale. */
export interface SaleLine {
  id: string;
  ticketNo: string;
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  paymentMethod: PaymentMethod;
  shift: Shift;
  /** staff ID */
  loggedBy: string;
  timestamp: string;
}

/* --- stock & COGS (what the branch bought) --- */

/** Purchase-picker family, e.g. VEGETABLES → Onion. Each maps to one COGS category. */
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

export interface InventoryItem {
  id: string;
  nameKey: string;
  category: COGSCategory;
  main: MainCategory;
  groupKey: string;
  unit: string;
  unitCost: number;
  aliases: string[];
  /** current stock level, changed by purchase approvals (+), dispatch approvals (−) and waste (−) */
  currentQuantity: number;
  /** reorder threshold: the item is LOW STOCK when currentQuantity <= reorderPoint */
  reorderPoint: number;
}

export type ReviewStatus = "PENDING" | "APPROVED" | "FLAGGED";

/** A stock purchase sent in by the inventory clerk for the manager to review. */
export interface CogsPurchase {
  id: string;
  itemId: string;
  category: COGSCategory;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  vendor: string;
  paymentMethod: "CASH" | "TELEBIRR" | "CBE_BIRR";
  /** staff ID */
  loggedBy: string;
  timestamp: string;
  status: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  flagReason?: string;
}

/* --- dispatch queue --- */

export type Destination = "BAR" | "KITCHEN_LINE" | "TAKEAWAY_COUNTER" | "CATERING" | "BRANCH_PIASSA" | "EVENT_HALL";

export interface DispatchRecord extends DispatchRequest {
  itemId: string;
  destination: Destination;
  /** staff ID of the manager who approved or rejected */
  approvedBy?: string;
  decidedAt?: string;
}

/* --- waste & expenses --- */

export interface WasteLog extends WasteReportRecord {
  itemId: string;
  /** staff ID of the person who entered the log (may differ from reportedBy) */
  loggedBy: string;
}

export type ExpenseSource = "PETTY_CASH" | "CASH" | "TELEBIRR" | "CBE_BIRR";

export interface ExpenseRecord {
  id: string;
  reason: string;
  amount: number;
  source: ExpenseSource;
  note: string;
  /** staff ID */
  loggedBy: string;
  timestamp: string;
}

/* --- audit --- */

export type AuditAction =
  | "APPROVE_DISPATCH"
  | "REJECT_DISPATCH"
  | "APPROVE_PURCHASE"
  | "FLAG_PURCHASE"
  | "LOG_WASTE"
  | "LOG_EXPENSE"
  | "UNDO"
  | "SWITCH_USER";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  /** stock item name key (rendered in the current language) */
  itemKey?: string;
  quantity?: number;
  unit?: string;
  destination?: Destination;
  /** free text, e.g. an expense reason or a rejection reason */
  text?: string;
  amount?: number;
  /** staff ID */
  userId: string;
  timestamp: string;
}

export type FieldErrors = Partial<Record<string, string>>;
