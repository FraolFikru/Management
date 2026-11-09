/* =========================================================
   System Admin & Configuration — domain types.
   The interfaces from the spec are kept as written; fields the UI
   needs on top of them are added and marked "added".
   ========================================================= */

export type SupportedLanguage = "en" | "am" | "om";

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

export type ViewId = "store" | "branches" | "access" | "receipt" | "audit";

export type UserRole = "ADMIN" | "BRANCH_MANAGER" | "SALES_STAFF" | "KITCHEN_STAFF" | "INVENTORY_CLERK";

export type CurrencySymbol = "ETB" | "Br";

export interface StoreProfile {
  id: string;
  businessName: string;
  branchName: string;
  tinNumber: string;
  vatNumber: string;
  address: string;
  phone: string;
  currency: string; // Default: 'ETB'
  vatRate: number; // Default: 15
  isVatEnabled: boolean;
  /** added: trade licence number */
  licenseNumber: string;
  /** added: how amounts are written — "ETB 1,250.00" or "Br 1,250.00" */
  currencySymbol: CurrencySymbol;
}

export interface RolePermissions {
  role: UserRole;
  canViewReports: boolean;
  canApproveDispatch: boolean;
  canEditPrices: boolean;
  canLogWaste: boolean;
  canAccessAdmin: boolean;
  /** added: ring up sales at the register */
  canMakeSales: boolean;
  /** added: send dispatch requests to the store room */
  canRequestDispatch: boolean;
  /** added: log custom expenses */
  canLogExpenses: boolean;
  /** added: manually override stock counts */
  canOverrideInventory: boolean;
}

export type PermissionKey = Exclude<keyof RolePermissions, "role">;

export type PrinterConnection = "USB" | "LAN";

export interface ReceiptConfig {
  paperWidthMm: 80 | 58;
  headerMessage: string;
  footerMessage: string;
  showTinOnReceipt: boolean;
  showVatBreakdown: boolean;
  /** added: printer the branch sends receipts to */
  printerName: string;
  connection: PrinterConnection;
  /** added: IP address for LAN printers */
  printerIp: string;
}

export interface UserAccount {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  assignedBranchId: string;
  isActive: boolean;
  /** added */
  phone: string;
  lastLoginAt?: string;
}

/** added: a branch location. */
export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  managerId: string;
  isActive: boolean;
  openedOn: string;
}

/** added: master price book. Branches use the base price unless they have their own. */
export interface MenuPrice {
  id: string;
  category: "FOOD" | "DRINK";
  basePrice: number;
  overrides: Record<string, number>;
}

export type AuditKind = "LOGIN" | "PRICE" | "ROLE" | "USER" | "INVENTORY" | "SETTINGS" | "BRANCH" | "EXPORT";

/** added: one line in the system activity log. `text` is an English
    template (translated at render), `vars` fill its placeholders. */
export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  branchId: string;
  kind: AuditKind;
  text: string;
  vars: Record<string, string | number>;
}

export type PaymentMethod = "CASH" | "TELEBIRR" | "CBE_BIRR";

/** added: a sales transaction (for export / backup). */
export interface Transaction {
  id: string;
  receiptNo: string;
  at: string;
  branchId: string;
  cashierId: string;
  method: PaymentMethod;
  items: number;
  subtotal: number;
  vat: number;
  total: number;
}

export type FieldErrors = Record<string, string>;
