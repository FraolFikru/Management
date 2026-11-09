/* =========================================================
   Finance & Accounting — domain types.
   Revenue is recorded from daily Z-reports (VAT-inclusive);
   costs come from vendor bills (accrual, by bill date) and the
   monthly payroll journal. Payments settle bills via Cash,
   Telebirr or CBE Birr, with 3% withholding where it applies.
   ========================================================= */

export type SupportedLanguage = "en" | "am" | "om";

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

export type ViewId = "pnl" | "payables" | "tax" | "cash";
export type PaymentMethod = "CASH" | "TELEBIRR" | "CBE_BIRR";

/** Where money sits. Card / bank transfers land in the CBE bank account. */
export type AccountId = "CASH" | "BANK" | "TELEBIRR" | "CBE_BIRR";

export type COGSCategory = "RAW_INGREDIENTS" | "BEVERAGE_BAR" | "PACKAGING_DISPOSABLES" | "KITCHEN_CONSUMABLES" | "CLEANING_SANITATION";
export type OpexCategory = "RENT" | "UTILITIES" | "PAYROLL" | "MARKETING" | "REPAIRS" | "FEES" | "OTHER_OPEX";
export type CostCategory = COGSCategory | OpexCategory;

/* --- revenue --- */

/** One day's register Z-report. `gross` includes 15% VAT. */
export interface DailySales {
  date: string;
  gross: number;
  vat: number;
  byMethod: Record<PaymentMethod, number>;
  food: number;
  beverage: number;
}

/* --- payables --- */

export interface Vendor {
  id: string;
  name: string;
  tin: string;
  /** charges VAT on invoices (input VAT is deductible) */
  vatRegistered: boolean;
  /** goods vs services decides the withholding threshold */
  supplyKind: "GOODS" | "SERVICES";
  category: CostCategory;
  termsDays: number;
  phone: string;
}

export interface BillPayment {
  id: string;
  date: string;
  /** amount of the bill settled (before withholding) */
  amount: number;
  /** 3% (or 30% without TIN) kept back and paid to the tax authority */
  withheld: number;
  /** what actually left the account */
  netPaid: number;
  method: PaymentMethod;
  reference: string;
  paidBy: string;
  timestamp: string;
}

export interface Bill {
  id: string;
  vendorId: string;
  billNo: string;
  category: CostCategory;
  issueDate: string;
  dueDate: string;
  description: string;
  /** amount before VAT */
  subtotal: number;
  vat: number;
  total: number;
  /** a valid VAT receipt is on file (needed to deduct input VAT) */
  hasReceipt: boolean;
  payments: BillPayment[];
  enteredBy: string;
}

export type BillStatus = "OPEN" | "PARTIAL" | "DUE_SOON" | "OVERDUE" | "PAID";

/* --- payroll journal (from the HR module) --- */

export interface PayrollCost {
  month: string; // YYYY-MM
  gross: number;
  employerPension: number;
  paidOn: string;
}

/* --- tax --- */

export interface TaxFiling {
  month: string; // YYYY-MM
  kind: "VAT" | "WHT";
  status: "OPEN" | "FILED";
  filedBy?: string;
  filedAt?: string;
  reference?: string;
}

/* --- cash & reconciliation --- */

export interface Reconciliation {
  date: string;
  /** cash the register says should be in the drawer */
  cashExpected: number;
  cashCounted: number;
  /** cash taken to the CBE branch */
  bankDeposit: number;
  /** deposit shows on the CBE bank statement */
  bankConfirmed: boolean;
  telebirrExpected: number;
  telebirrReceived: number;
  cbeBirrExpected: number;
  cbeBirrReceived: number;
  status: "PENDING" | "MATCHED" | "VARIANCE";
  note: string;
  reconciledBy?: string;
  reconciledAt?: string;
}

export interface Movement {
  date: string;
  account: AccountId;
  /** positive = in, negative = out */
  amount: number;
  label: string;
  kind: "SALES" | "DEPOSIT" | "VENDOR" | "PAYROLL" | "TAX" | "FEE" | "TRANSFER";
}

export type FieldErrors = Partial<Record<string, string>>;
