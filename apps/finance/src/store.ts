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
import { ACCOUNT_IDS, COGS_IDS, DAILY_FLOAT, DUE_SOON_DAYS, METHOD_ACCOUNT, OPEX_IDS, PROFIT_TAX_RATE, RECON_TOLERANCE, ROLE_LABEL, USERS, isCogs } from "./catalog";
import { OPENING, VENDORS, generateSeed, lastOfMonth, monthKey, newId, vendorById, withholdingRate } from "./seed";
import { registerText } from "./i18n";
import { isLive, loadAll, remote, sessionUser, signOut as apiSignOut } from "./api";
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

/* ---------- live mode (backend) ----------
   The screen updates at once; the change is then sent. If the backend
   refuses it, the change is rolled back and onSyncError says why. */

let signedInLive = false;
export const signedIn = (): boolean => !isLive || signedInLive;
/** Live mode: the branch whose till is reconciled, and its name. */
export const live = { branch: "", branchName: "" };
/** Money movements from the backend ledger (bill payments are rebuilt from the bills). */
let ledger: Movement[] = [];
/** Money moved by this session's filings and reconciliations (until the next load). */
let sessionMoves: Movement[] = [];
/** Bank deposit already booked per reconciled day. */
let deposits: Record<string, number> = {};

let syncError: (message: string) => void = () => {};
export function onSyncError(fn: (message: string) => void): void { syncError = fn; }

function push<T>(task: () => Promise<T>, rollback: () => void, then?: (r: T) => void): void {
  if (!isLive) return;
  task().then((r) => then?.(r), (err: unknown) => {
    rollback();
    syncError(err instanceof Error ? err.message : String(err));
  });
}

const dropMoves = (list: Movement[]): void => { sessionMoves = sessionMoves.filter((m) => !list.includes(m)); };

/** Replace the demo books with the real ones (after a live sign-in). Throws "no-access" if this account can't use the app. */
export async function loadFromBackend(): Promise<void> {
  const b = await loadAll().catch((err: unknown) => {
    throw (err as { status?: number }).status === 403 ? new Error("no-access") : err;
  });
  const u = sessionUser();
  if (!b.role || !u) throw new Error("no-access");
  USERS.splice(0, USERS.length, ...b.users.map((x) => {
    const role = ROLE_LABEL[x.role] ?? { en: x.role, am: x.role, om: x.role };
    registerText(`user.${x.id}`, role);
    return { id: x.id, name: x.name, role };
  }));
  VENDORS.splice(0, VENDORS.length, ...b.vendors);
  Object.assign(OPENING, b.opening);
  db.start = b.start;
  db.sales = b.sales;
  db.bills = b.bills;
  db.payroll = b.payroll;
  db.filings = b.filings;
  db.recon = b.recon;
  db.vendors = b.vendors.filter((v) => !v.internal);
  ledger = b.movements;
  deposits = b.deposits;
  sessionMoves = [];
  live.branch = b.reconBranch;
  live.branchName = b.reconBranchName;
  state.userId = u.id;
  signedInLive = true;
}

export function signOut(): void {
  void apiSignOut();
  signedInLive = false;
}

/** Live movements: the backend ledger + bill payments from the bills + what this session moved. */
function liveMovements(): Movement[] {
  const out: Movement[] = [...ledger, ...sessionMoves];
  for (const b of db.bills) for (const p of b.payments) {
    if (p.noCash) continue;
    out.push({ date: p.date, account: METHOD_ACCOUNT[p.method], amount: -p.netPaid, label: vendorById(b.vendorId)?.name ?? b.vendorId, kind: "VENDOR" });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
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
  const was = { ...f };
  f.status = "FILED";
  f.filedBy = state.userId;
  f.filedAt = new Date().toISOString();
  f.reference = reference;
  if (isLive) {
    const v = vatSummary(month);
    const amount = round2(kind === "VAT" ? Math.max(0, v.net) : v.withheld);
    f.amount = amount;
    const moves: Movement[] = amount ? [{ date: today(), account: "BANK", amount: -amount, label: `${kind} ${month}`, kind: "TAX" }] : [];
    sessionMoves.push(...moves);
    push(() => remote.filing(month, kind, true, reference, amount), () => { resetObj(f, was); dropMoves(moves); });
  }
  return f;
}

export function reopenReturn(month: string, kind: "VAT" | "WHT"): void {
  const f = filing(month, kind);
  const was = { ...f };
  const paid = f.status === "FILED" ? f.amount ?? 0 : 0;
  f.status = "OPEN";
  delete f.filedBy; delete f.filedAt; delete f.reference; delete f.amount;
  if (isLive) {
    const moves: Movement[] = paid ? [{ date: today(), account: "BANK", amount: paid, label: `Reversed ${kind} ${month}`, kind: "TAX" }] : [];
    sessionMoves.push(...moves);
    push(() => remote.filing(month, kind, false), () => { resetObj(f, was); dropMoves(moves); });
  }
}

/** Put an object back exactly as it was (fields added since are removed). */
function resetObj<T extends object>(obj: T, before: T): void {
  for (const k of Object.keys(obj)) if (!(k in before)) delete (obj as Record<string, unknown>)[k];
  Object.assign(obj, before);
}

/* ---------- payables writes ---------- */

export function addBill(data: Omit<Bill, "id" | "payments" | "enteredBy" | "vat" | "total" | "dueDate"> & { dueDate?: string }): Bill {
  const v = vendorById(data.vendorId) as Vendor;
  const vat = v.vatRegistered ? round2(data.subtotal * 0.15) : 0;
  const b: Bill = {
    ...data, id: newId("bill"), vat, total: round2(data.subtotal + vat), dueDate: data.dueDate ?? addDays(data.issueDate, v.termsDays), payments: [], enteredBy: state.userId,
  };
  db.bills.push(b);
  push(() => remote.addBill(b), () => { db.bills = db.bills.filter((x) => x !== b); });
  return b;
}

export const removeBill = (id: string): void => {
  const b = db.bills.find((x) => x.id === id);
  db.bills = db.bills.filter((x) => x.id !== id);
  if (b) push(() => remote.voidBill(id), () => { db.bills.push(b); });
};

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
  // the backend works out withholding on the pre-VAT part of what is settled: keep its figures
  push(() => remote.pay(b.id, p), () => { b.payments = b.payments.filter((x) => x !== p); },
    (r) => { p.withheld = Number(r.withheld); p.netPaid = Number(r.netPaid); });
  return p;
}

export function unpay(billId: string, paymentId: string): void {
  const b = db.bills.find((x) => x.id === billId);
  if (!b) return;
  const p = b.payments.find((x) => x.id === paymentId);
  b.payments = b.payments.filter((x) => x.id !== paymentId);
  if (p) push(() => remote.unpay(paymentId), () => { b.payments.push(p); });
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
  const was = { ...r };
  Object.assign(r, v);
  r.status = reconStatus(r);
  r.reconciledBy = state.userId;
  r.reconciledAt = new Date().toISOString();
  if (isLive) {
    // a confirmed deposit moves that cash from the safe to the bank (re-saving adjusts it), as the backend does
    const done = deposits[date] ?? 0;
    const delta = round2((r.bankConfirmed ? r.bankDeposit : 0) - done);
    const day = addDays(date, 1);
    const moves: Movement[] = delta ? [
      { date: day, account: "CASH", amount: -delta, label: "Deposit to CBE", kind: "DEPOSIT" },
      { date: day, account: "BANK", amount: delta, label: "Cash deposit", kind: "DEPOSIT" },
    ] : [];
    sessionMoves.push(...moves);
    deposits[date] = done + delta;
    push(() => remote.recon(live.branch, r), () => { resetObj(r, was); dropMoves(moves); deposits[date] = done; });
  }
  return r;
}

/* ---------- cash movements & balances ---------- */

export function movements(): Movement[] {
  if (isLive) return liveMovements();
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
