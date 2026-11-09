/* =========================================================
   State, books and calculations.
   - P&L (accrual): net revenue = Z-report gross − output VAT;
     COGS and operating costs = bill subtotals (+ VAT that cannot be
     deducted) by bill date; payroll from the monthly journal.
   - VAT: output (sales) − deductible input (VAT-registered vendor
     with a receipt on file) = payable, due last day of next month.
   - Withholding: kept back on supplier payments, remitted monthly.
   - Accounts: movements from sales, deposits, payments, payroll, tax.
   Every write is stamped with the signed-in user.
   ========================================================= */

import type {
  AccountId, Bill, BillPayment, BillStatus, CostCategory, FieldErrors, Movement, PaymentMethod, PayrollCost, Reconciliation, SupportedLanguage, TaxFiling, Vendor, ViewId,
} from "./types";
import { ACCOUNT_IDS, COGS_IDS, DAILY_FLOAT, DUE_SOON_DAYS, METHOD_ACCOUNT, OPEX_IDS, PROFIT_TAX_RATE, RECON_TOLERANCE, USERS, isCogs } from "./catalog";
import { OPENING, VENDORS, generateSeed, lastOfMonth, monthKey, newId, vendorById, withholdingRate } from "./seed";
import { addDays, daysBetween, parseDay, round2, today } from "./format";

/* ---------- UI state ---------- */

export type PeriodId = "this" | "last" | "q" | "fy";

export type Modal =
  | { kind: "pay"; billId: string }
  | { kind: "bill" }
  | { kind: "recon"; date: string }
  | { kind: "file"; month: string; tax: "VAT" | "WHT" }
  | null;

export interface UiState {
  lang: SupportedLanguage;
  theme: "dark" | "light";
  userId: string;
  view: ViewId;
  period: PeriodId;
  apFilter: "OUTSTANDING" | "OVERDUE" | "DUE_SOON" | "PAID" | "ALL";
  apVendor: string;
  apOpen: string | null;
  taxMonth: string;
  cashMonth: string;
  modal: Modal;
  errors: FieldErrors;
  userMenu: boolean;
}

const PREFS_KEY = "finance-accounting-v1";
function loadPrefs(): Partial<UiState> {
  try { const raw = localStorage.getItem(PREFS_KEY); return raw ? (JSON.parse(raw) as Partial<UiState>) : {}; } catch { return {}; }
}
const prefs = loadPrefs();
const prevMonthOf = (m: string): string => monthKey(addDays(`${m}-01`, -1));

export const state: UiState = {
  lang: prefs.lang === "am" || prefs.lang === "om" ? prefs.lang : "en",
  theme: prefs.theme === "light" ? "light" : "dark",
  userId: USERS.some((u) => u.id === prefs.userId) ? (prefs.userId as string) : "EMP-020",
  view: "pnl",
  period: "this",
  apFilter: "OUTSTANDING",
  apVendor: "ALL",
  apOpen: null,
  taxMonth: prevMonthOf(monthKey(today())),
  cashMonth: monthKey(today()),
  modal: null,
  errors: {},
  userMenu: false,
};

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ lang: state.lang, theme: state.theme, userId: state.userId })); } catch { /* not persisted */ }
}

/* ---------- data ---------- */

const seed = generateSeed();
export const db = {
  start: seed.start,
  sales: seed.sales,
  bills: seed.bills,
  payroll: seed.payroll,
  filings: seed.filings,
  recon: seed.recon,
  vendors: VENDORS,
};

export const user = () => USERS.find((u) => u.id === state.userId) ?? USERS[0];
export const userName = (id: string): string => USERS.find((u) => u.id === id)?.name ?? id;

/* ---------- periods ---------- */

export function periodRange(p: PeriodId = state.period): { from: string; to: string; label: string; prev: [string, string] } {
  const now = today();
  const d = parseDay(now);
  const ym = (y: number, m: number): string => `${new Date(y, m, 1).getFullYear()}-${String(new Date(y, m, 1).getMonth() + 1).padStart(2, "0")}`;
  if (p === "this") {
    const from = `${monthKey(now)}-01`;
    const n = daysBetween(from, now);
    const pf = `${ym(d.getFullYear(), d.getMonth() - 1)}-01`;
    return { from, to: now, label: "month to date", prev: [pf, addDays(pf, n)] };
  }
  if (p === "last") {
    const m = ym(d.getFullYear(), d.getMonth() - 1);
    const pm = ym(d.getFullYear(), d.getMonth() - 2);
    return { from: `${m}-01`, to: lastOfMonth(m), label: "last month", prev: [`${pm}-01`, lastOfMonth(pm)] };
  }
  if (p === "q") {
    const from = `${ym(d.getFullYear(), d.getMonth() - 2)}-01`;
    const pfrom = `${ym(d.getFullYear(), d.getMonth() - 5)}-01`;
    return { from, to: now, label: "last 3 months", prev: [pfrom < db.start ? db.start : pfrom, addDays(from, -1)] };
  }
  // Ethiopian fiscal year starts on Hamle 1 (8 July)
  const fyStartYear = d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() >= 8) ? d.getFullYear() : d.getFullYear() - 1;
  const from = `${fyStartYear}-07-08`;
  return { from: from < db.start ? db.start : from, to: now, label: "fiscal year to date", prev: ["", ""] };
}

const WALLET_FLOAT = 60000;
const within = (day: string, from: string, to: string): boolean => day >= from && day <= to;

/* ---------- bills ---------- */

export const paidOn = (b: Bill): number => round2(b.payments.reduce((s, p) => s + p.amount, 0));
export const balanceOf = (b: Bill): number => round2(b.total - paidOn(b));

export function billStatus(b: Bill): BillStatus {
  const bal = balanceOf(b);
  if (bal <= 0.005) return "PAID";
  const days = daysBetween(today(), b.dueDate);
  if (days < 0) return "OVERDUE";
  if (days <= DUE_SOON_DAYS) return "DUE_SOON";
  return paidOn(b) > 0 ? "PARTIAL" : "OPEN";
}

/** VAT on the bill that can be claimed back. */
export const deductibleVat = (b: Bill): number => (vendorById(b.vendorId)?.vatRegistered && b.hasReceipt ? b.vat : 0);
/** Cost recognised on the P&L: subtotal plus any VAT that cannot be deducted. */
export const costOf = (b: Bill): number => round2(b.subtotal + b.vat - deductibleVat(b));

export function agingBuckets(): { current: number; d30: number; d60: number; d60p: number } {
  const out = { current: 0, d30: 0, d60: 0, d60p: 0 };
  for (const b of db.bills) {
    const bal = balanceOf(b);
    if (bal <= 0.005) continue;
    const late = daysBetween(b.dueDate, today());
    if (late <= 0) out.current += bal;
    else if (late <= 30) out.d30 += bal;
    else if (late <= 60) out.d60 += bal;
    else out.d60p += bal;
  }
  return out;
}

/* ---------- P&L ---------- */

export interface Pnl {
  grossSales: number;
  outputVat: number;
  netRevenue: number;
  food: number;
  beverage: number;
  cogs: Record<string, number>;
  totalCogs: number;
  grossProfit: number;
  opex: Record<string, number>;
  totalOpex: number;
  operatingProfit: number;
  profitTax: number;
  netProfit: number;
  /** payroll for an unfinished month is accrued pro rata */
  payrollAccrued: boolean;
  /** rent for an unfinished month is spread by day */
  rentAccrued: boolean;
}

function payrollFor(from: string, to: string): { cost: number; accrued: boolean } {
  let cost = 0;
  let accrued = false;
  const months = new Set<string>();
  for (let d = from; d <= to; d = addDays(lastOfMonth(monthKey(d)), 1)) months.add(monthKey(d));
  for (const m of months) {
    const first = `${m}-01`;
    const last = lastOfMonth(m);
    const s = from > first ? from : first;
    const e = to < last ? to : last;
    const share = (daysBetween(s, e) + 1) / (daysBetween(first, last) + 1);
    const p = db.payroll.find((x) => x.month === m) ?? [...db.payroll].sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    if (!p) continue;
    if (!db.payroll.find((x) => x.month === m) || share < 1) accrued = true;
    cost += (p.gross + p.employerPension) * share;
  }
  return { cost, accrued };
}

export function pnl(from: string, to: string): Pnl {
  let grossSales = 0, outputVat = 0, food = 0, beverage = 0;
  for (const s of db.sales) if (within(s.date, from, to)) { grossSales += s.gross; outputVat += s.vat; food += s.food; beverage += s.beverage; }
  const cogs: Record<string, number> = Object.fromEntries(COGS_IDS.map((c) => [c, 0]));
  const opex: Record<string, number> = Object.fromEntries(OPEX_IDS.map((c) => [c, 0]));
  let rentAccrued = false;
  for (const b of db.bills) {
    if (b.category === "RENT") {
      // monthly rent is spread over the days of the month it covers
      const m = monthKey(b.issueDate), first = `${m}-01`, last = lastOfMonth(m);
      const s = from > first ? from : first, e = to < last ? to : last;
      if (s > e) continue;
      const share = (daysBetween(s, e) + 1) / (daysBetween(first, last) + 1);
      if (share < 1) rentAccrued = true;
      opex.RENT += costOf(b) * share;
      continue;
    }
    if (!within(b.issueDate, from, to)) continue;
    if (isCogs(b.category)) cogs[b.category] += costOf(b); else opex[b.category] += costOf(b);
  }
  const pay = payrollFor(from, to);
  opex.PAYROLL += pay.cost;
  // wallet / bank charges: 0.5% of mobile-money receipts
  for (const s of db.sales) if (within(s.date, from, to)) opex.FEES += (s.byMethod.TELEBIRR + s.byMethod.CBE_BIRR) * 0.005;
  const netRevenue = grossSales - outputVat;
  const totalCogs = Object.values(cogs).reduce((a, b) => a + b, 0);
  const totalOpex = Object.values(opex).reduce((a, b) => a + b, 0);
  const operatingProfit = netRevenue - totalCogs - totalOpex;
  const profitTax = Math.max(0, operatingProfit * PROFIT_TAX_RATE);
  return {
    grossSales, outputVat, netRevenue, food, beverage, cogs, totalCogs, grossProfit: netRevenue - totalCogs, opex, totalOpex,
    operatingProfit, profitTax, netProfit: operatingProfit - profitTax, payrollAccrued: pay.accrued, rentAccrued,
  };
}

/** Net revenue and net profit for each of the last six months (for the trend chart). */
export function monthlyTrend(): { month: string; revenue: number; profit: number; partial: boolean }[] {
  const out: { month: string; revenue: number; profit: number; partial: boolean }[] = [];
  for (let m = monthKey(db.start); m <= monthKey(today()); m = monthKey(addDays(lastOfMonth(m), 1))) {
    const to = lastOfMonth(m) < today() ? lastOfMonth(m) : today();
    const p = pnl(`${m}-01`, to);
    out.push({ month: m, revenue: p.netRevenue, profit: p.netProfit, partial: to !== lastOfMonth(m) });
  }
  return out;
}

/* ---------- tax ---------- */

export const filingDue = (month: string): string => lastOfMonth(monthKey(addDays(lastOfMonth(month), 1)));
export const filing = (month: string, kind: "VAT" | "WHT"): TaxFiling => {
  let f = db.filings.find((x) => x.month === month && x.kind === kind);
  if (!f) { f = { month, kind, status: "OPEN" }; db.filings.push(f); }
  return f;
};

export function vatSummary(month: string) {
  const from = `${month}-01`, to = lastOfMonth(month);
  const output = db.sales.filter((s) => within(s.date, from, to)).reduce((a, s) => a + s.vat, 0);
  const salesNet = db.sales.filter((s) => within(s.date, from, to)).reduce((a, s) => a + s.gross - s.vat, 0);
  const bills = db.bills.filter((b) => within(b.issueDate, from, to));
  const input = bills.reduce((a, b) => a + deductibleVat(b), 0);
  const blocked = bills.reduce((a, b) => a + (b.vat - deductibleVat(b)), 0);
  const withheld = bills.flatMap((b) => b.payments).filter((p) => within(p.date, from, to)).reduce((a, p) => a + p.withheld, 0);
  return { output, salesNet, input, blocked, net: output - input, withheld, due: filingDue(month), partial: to > today() };
}

export function fileReturn(month: string, kind: "VAT" | "WHT", reference: string): TaxFiling {
  const f = filing(month, kind);
  f.status = "FILED";
  f.filedBy = state.userId;
  f.filedAt = new Date().toISOString();
  f.reference = reference;
  return f;
}

export function reopenReturn(month: string, kind: "VAT" | "WHT"): void {
  const f = filing(month, kind);
  f.status = "OPEN";
  delete f.filedBy; delete f.filedAt; delete f.reference;
}

/* ---------- payables writes ---------- */

export function addBill(data: Omit<Bill, "id" | "payments" | "enteredBy" | "vat" | "total" | "dueDate"> & { dueDate?: string }): Bill {
  const v = vendorById(data.vendorId) as Vendor;
  const vat = v.vatRegistered ? round2(data.subtotal * 0.15) : 0;
  const b: Bill = {
    ...data, id: newId("bill"), vat, total: round2(data.subtotal + vat), dueDate: data.dueDate ?? addDays(data.issueDate, v.termsDays), payments: [], enteredBy: state.userId,
  };
  db.bills.push(b);
  return b;
}

export const removeBill = (id: string): void => { db.bills = db.bills.filter((b) => b.id !== id); };

export function payBill(billId: string, amount: number, method: PaymentMethod, reference: string, date: string): BillPayment | null {
  const b = db.bills.find((x) => x.id === billId);
  const v = b ? vendorById(b.vendorId) : undefined;
  if (!b || !v) return null;
  const amt = round2(Math.min(amount, balanceOf(b)));
  const withheld = round2(amt * withholdingRate(v, b.subtotal));
  const p: BillPayment = {
    id: newId("pay"), date, amount: amt, withheld, netPaid: round2(amt - withheld), method, reference, paidBy: state.userId, timestamp: new Date().toISOString(),
  };
  b.payments.push(p);
  return p;
}

export function unpay(billId: string, paymentId: string): void {
  const b = db.bills.find((x) => x.id === billId);
  if (b) b.payments = b.payments.filter((p) => p.id !== paymentId);
}

/* ---------- reconciliation ---------- */

export function reconStatus(r: Pick<Reconciliation, "cashExpected" | "cashCounted" | "bankDeposit" | "telebirrExpected" | "telebirrReceived" | "cbeBirrExpected" | "cbeBirrReceived" | "bankConfirmed">): "MATCHED" | "VARIANCE" {
  const off = (a: number, b: number): boolean => Math.abs(a - b) > RECON_TOLERANCE;
  return off(r.cashCounted, r.cashExpected) || off(r.bankDeposit, r.cashCounted - DAILY_FLOAT) || !r.bankConfirmed || off(r.telebirrReceived, r.telebirrExpected) || off(r.cbeBirrReceived, r.cbeBirrExpected)
    ? "VARIANCE" : "MATCHED";
}

export function saveRecon(date: string, v: Omit<Reconciliation, "date" | "status" | "reconciledBy" | "reconciledAt" | "cashExpected" | "telebirrExpected" | "cbeBirrExpected">): Reconciliation | null {
  const r = db.recon.find((x) => x.date === date);
  if (!r) return null;
  Object.assign(r, v);
  r.status = reconStatus(r);
  r.reconciledBy = state.userId;
  r.reconciledAt = new Date().toISOString();
  return r;
}

/* ---------- cash movements & balances ---------- */

export function movements(): Movement[] {
  const out: Movement[] = [];
  for (const s of db.sales) {
    out.push({ date: s.date, account: "CASH", amount: s.byMethod.CASH, label: "Cash sales", kind: "SALES" });
    out.push({ date: s.date, account: "TELEBIRR", amount: s.byMethod.TELEBIRR * 0.995, label: "Telebirr sales (net of 0.5% fee)", kind: "SALES" });
    out.push({ date: s.date, account: "CBE_BIRR", amount: s.byMethod.CBE_BIRR * 0.995, label: "CBE Birr sales (net of 0.5% fee)", kind: "SALES" });
    // cash is deposited the next morning; use the counted amount when reconciled
    const r = db.recon.find((x) => x.date === s.date);
    const dep = r ? (r.status === "PENDING" ? 0 : r.bankDeposit) : s.byMethod.CASH - DAILY_FLOAT;
    if (dep) {
      out.push({ date: addDays(s.date, 1), account: "CASH", amount: -dep, label: "Deposit to CBE", kind: "DEPOSIT" });
      out.push({ date: addDays(s.date, 1), account: "BANK", amount: dep, label: "Cash deposit", kind: "DEPOSIT" });
    }
    if (r && r.status !== "PENDING" && r.cashCounted !== r.cashExpected) out.push({ date: s.date, account: "CASH", amount: r.cashCounted - r.cashExpected, label: "Drawer difference", kind: "SALES" });
  }
  for (const b of db.bills) for (const p of b.payments) {
    out.push({ date: p.date, account: METHOD_ACCOUNT[p.method], amount: -p.netPaid, label: vendorById(b.vendorId)?.name ?? b.vendorId, kind: "VENDOR" });
  }
  for (const p of db.payroll) out.push({ date: p.paidOn, account: "BANK", amount: -(p.gross + p.employerPension), label: `Payroll ${p.month}`, kind: "PAYROLL" });
  for (const f of db.filings) {
    if (f.status !== "FILED" || !f.filedAt) continue;
    const v = vatSummary(f.month);
    const amt = f.kind === "VAT" ? Math.max(0, v.net) : v.withheld;
    if (amt) out.push({ date: f.filedAt.slice(0, 10), account: "BANK", amount: -amt, label: `${f.kind} ${f.month}`, kind: "TAX" });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Every Monday, wallet balances above the working float are swept to the CBE bank account.
  const bal = { ...OPENING } as Record<AccountId, number>;
  const withSweeps: Movement[] = [];
  let i = 0;
  for (let d = db.start; d <= today(); d = addDays(d, 1)) {
    if (parseDay(d).getDay() === 1) for (const w of ["TELEBIRR", "CBE_BIRR"] as const) {
      const excess = round2(bal[w] - WALLET_FLOAT);
      if (excess <= 0) continue;
      withSweeps.push({ date: d, account: w, amount: -excess, label: "Wallet sweep to CBE bank", kind: "DEPOSIT" });
      withSweeps.push({ date: d, account: "BANK", amount: excess, label: w === "TELEBIRR" ? "Telebirr sweep" : "CBE Birr sweep", kind: "DEPOSIT" });
      bal[w] -= excess; bal.BANK += excess;
    }
    for (; i < out.length && out[i].date <= d; i++) { withSweeps.push(out[i]); bal[out[i].account] += out[i].amount; }
  }
  return withSweeps;
}

export function balances(asOf = today()): Record<AccountId, number> {
  const bal = { ...OPENING } as Record<AccountId, number>;
  for (const m of movements()) if (m.date <= asOf) bal[m.account] += m.amount;
  for (const a of ACCOUNT_IDS) bal[a] = round2(bal[a]);
  return bal;
}

export const costCategoryOfVendor = (vendorId: string): CostCategory | undefined => vendorById(vendorId)?.category;
export type { PayrollCost };
