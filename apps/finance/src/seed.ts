/* =========================================================
   Deterministic sample books for the Bole branch, relative to
   today: ~6 months of daily Z-reports, vendor bills and their
   payments (with withholding), monthly payroll journals, VAT /
   withholding filings and daily cash reconciliations.
   ========================================================= */

import type { Bill, BillPayment, CostCategory, DailySales, PaymentMethod, PayrollCost, Reconciliation, TaxFiling, Vendor } from "./types";
import { DAILY_FLOAT, VAT_RATE, WHT_RATE, WHT_RATE_NO_TIN, WHT_THRESHOLD } from "./catalog";
import { addDays, dayOf, parseDay, round2, today } from "./format";

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

export const VENDORS: Vendor[] = [
  { id: "V-01", name: "Merkato Fresh Produce", tin: "0041235567", vatRegistered: false, supplyKind: "GOODS", category: "RAW_INGREDIENTS", termsDays: 7, phone: "+251 911 400 101" },
  { id: "V-02", name: "Sheger Meat & Poultry PLC", tin: "0052318890", vatRegistered: true, supplyKind: "GOODS", category: "RAW_INGREDIENTS", termsDays: 14, phone: "+251 911 400 202" },
  { id: "V-03", name: "Sululta Dairy Union", tin: "0063321104", vatRegistered: true, supplyKind: "GOODS", category: "RAW_INGREDIENTS", termsDays: 14, phone: "+251 911 400 303" },
  { id: "V-04", name: "Gojjam Teff & Injera Supply", tin: "0074411209", vatRegistered: false, supplyKind: "GOODS", category: "RAW_INGREDIENTS", termsDays: 7, phone: "+251 911 400 404" },
  { id: "V-05", name: "Ethio Beverage Distributors", tin: "0085521330", vatRegistered: true, supplyKind: "GOODS", category: "BEVERAGE_BAR", termsDays: 30, phone: "+251 911 400 505" },
  { id: "V-06", name: "Highland Coffee Roasters", tin: "0096631441", vatRegistered: true, supplyKind: "GOODS", category: "BEVERAGE_BAR", termsDays: 21, phone: "+251 911 400 606" },
  { id: "V-07", name: "Addis Packaging PLC", tin: "0107741552", vatRegistered: true, supplyKind: "GOODS", category: "PACKAGING_DISPOSABLES", termsDays: 30, phone: "+251 911 400 707" },
  { id: "V-08", name: "Bole Kitchen Supply", tin: "0118851663", vatRegistered: true, supplyKind: "GOODS", category: "KITCHEN_CONSUMABLES", termsDays: 30, phone: "+251 911 400 808" },
  { id: "V-09", name: "Sheger Cleaning Supplies", tin: "0129961774", vatRegistered: true, supplyKind: "GOODS", category: "CLEANING_SANITATION", termsDays: 30, phone: "+251 911 400 909" },
  { id: "V-10", name: "Bole Properties (landlord)", tin: "0131071885", vatRegistered: true, supplyKind: "SERVICES", category: "RENT", termsDays: 5, phone: "+251 911 401 010" },
  { id: "V-11", name: "City power & water", tin: "0142181996", vatRegistered: true, supplyKind: "SERVICES", category: "UTILITIES", termsDays: 10, phone: "+251 911 401 111" },
  { id: "V-12", name: "Nile Gas Cylinders", tin: "0153292107", vatRegistered: true, supplyKind: "GOODS", category: "UTILITIES", termsDays: 7, phone: "+251 911 401 212" },
  { id: "V-13", name: "Habesha Print & Ads", tin: "0164303218", vatRegistered: true, supplyKind: "SERVICES", category: "MARKETING", termsDays: 30, phone: "+251 911 401 313" },
  { id: "V-14", name: "Fix-It Kitchen Repairs", tin: "", vatRegistered: false, supplyKind: "SERVICES", category: "REPAIRS", termsDays: 7, phone: "+251 911 401 414" },
];

export const vendorById = (id: string): Vendor | undefined => VENDORS.find((v) => v.id === id);

/** Withholding on a payment: 3% at or above the threshold, 30% without a TIN, 0 below the threshold. */
export function withholdingRate(v: Vendor, billSubtotal: number): number {
  if (billSubtotal < WHT_THRESHOLD[v.supplyKind]) return 0;
  return v.tin ? WHT_RATE : WHT_RATE_NO_TIN;
}

/** Opening balances on the first seeded day. */
export const OPENING = { CASH: 20000, BANK: 650000, TELEBIRR: 40000, CBE_BIRR: 30000 };

export interface SeedData {
  start: string;
  sales: DailySales[];
  bills: Bill[];
  payroll: PayrollCost[];
  filings: TaxFiling[];
  recon: Reconciliation[];
}

export const monthKey = (day: string): string => day.slice(0, 7);
export const monthStart = (day: string): string => `${monthKey(day)}-01`;
export const lastOfMonth = (month: string): string => { const [y, m] = month.split("-").map(Number); return dayOf(new Date(y, m, 0)); };

export function generateSeed(): SeedData {
  const r = rng(20261107);
  const now = today();
  const d = parseDay(now);
  const start = dayOf(new Date(d.getFullYear(), d.getMonth() - 5, 1));
  const between = (a: number, b: number): number => Math.round(a + r() * (b - a));
  const out: SeedData = { start, sales: [], bills: [], payroll: [], filings: [], recon: [] };

  /* ---------- daily sales (Z-reports) up to yesterday; today's report comes at close ---------- */
  for (let day = start; day < now; day = addDays(day, 1)) {
    const dow = parseDay(day).getDay();
    const weekend = dow === 0 || dow === 6;
    const gross = round2(between(46, 72) * 1000 * (weekend ? 1.22 : 1) + between(0, 999));
    const vat = round2((gross * VAT_RATE) / (1 + VAT_RATE));
    const cashShare = 0.46 + r() * 0.1;
    const teleShare = 0.27 + r() * 0.08;
    const cash = round2(gross * cashShare);
    const tele = round2(gross * teleShare);
    const net = gross - vat;
    const food = round2(net * (0.74 + r() * 0.06));
    out.sales.push({ date: day, gross, vat, byMethod: { CASH: cash, TELEBIRR: tele, CBE_BIRR: round2(gross - cash - tele) }, food, beverage: round2(net - food) });
  }

  /* ---------- bills ---------- */
  let billNo = 3100;
  const bill = (vendorId: string, issueDate: string, subtotal: number, description: string, category?: CostCategory): Bill | null => {
    if (issueDate > now) return null;
    const v = vendorById(vendorId);
    if (!v) return null;
    const sub = round2(subtotal);
    const vat = v.vatRegistered ? round2(sub * VAT_RATE) : 0;
    const b: Bill = {
      id: newId("bill"), vendorId, billNo: `${v.id.replace("V-", "INV-")}-${++billNo}`, category: category ?? v.category, issueDate,
      dueDate: addDays(issueDate, v.termsDays), description, subtotal: sub, vat, total: round2(sub + vat),
      hasReceipt: !v.vatRegistered || r() > 0.04, payments: [], enteredBy: "EMP-020",
    };
    out.bills.push(b);
    return b;
  };

  for (let m = 0; m < 6; m++) {
    const ms = dayOf(new Date(d.getFullYear(), d.getMonth() - 5 + m, 1));
    const month = monthKey(ms);
    // weekly fresh food
    for (let w = 0; w < 5; w++) {
      const day = addDays(ms, w * 7 + between(0, 2));
      if (monthKey(day) !== month) continue;
      bill("V-01", day, between(18, 30) * 1000, "Vegetables, onions, tomatoes, greens");
      bill("V-02", addDays(day, 1), between(28, 42) * 1000, "Beef, lamb, chicken");
      bill("V-03", addDays(day, 2), between(9, 15) * 1000, "Milk, butter (kibbeh), eggs");
      bill("V-04", addDays(day, 1), between(16, 24) * 1000, "Teff flour and injera");
    }
    bill("V-05", addDays(ms, 3), between(38, 52) * 1000, "Soft drinks, beer, water");
    bill("V-05", addDays(ms, 17), between(34, 48) * 1000, "Soft drinks, beer, water");
    bill("V-06", addDays(ms, 6), between(14, 20) * 1000, "Coffee beans, tea");
    bill("V-07", addDays(ms, 9), between(22, 34) * 1000, "Takeout boxes, cups, bags");
    bill("V-08", addDays(ms, 12), between(12, 22) * 1000, "Foil, cling film, gloves");
    bill("V-09", addDays(ms, 14), between(9, 16) * 1000, "Detergent, sanitizer, trash liners");
    bill("V-10", ms, 120000, "Monthly rent");
    bill("V-11", addDays(ms, 4), between(19, 26) * 1000, "Electricity and water");
    bill("V-12", addDays(ms, 2), between(11, 14) * 1000, "Gas cylinder refills");
    bill("V-12", addDays(ms, 16), between(11, 14) * 1000, "Gas cylinder refills");
    if (m % 2 === 0) bill("V-13", addDays(ms, 10), between(9, 14) * 1000, "Flyers and social media ads");
    if (r() < 0.6) bill("V-14", addDays(ms, between(5, 25)), between(4, 13) * 1000, "Fridge and stove repair");
    // bank / wallet fees post as a small monthly bill from the bank
    out.payroll.push({ month, gross: between(168, 182) * 1000, employerPension: between(17, 19) * 1000, paidOn: lastOfMonth(month) });
  }
  // the current month's payroll is not paid yet
  out.payroll = out.payroll.filter((p) => p.paidOn < now || monthKey(p.paidOn) !== monthKey(now));

  /* ---------- payments ---------- */
  const methodFor = (total: number): PaymentMethod => (total < 15000 ? "CASH" : total < 45000 ? "TELEBIRR" : "CBE_BIRR");
  for (const b of out.bills) {
    const v = vendorById(b.vendorId) as Vendor;
    const overdueRoll = r();
    let payDay = addDays(b.dueDate, between(-3, 2));
    if (overdueRoll < 0.08 && b.dueDate < now && b.dueDate >= addDays(now, -75)) continue; // left overdue (recent bills only)
    if (payDay >= now) {
      if (b.dueDate >= now) continue; // not due yet: stays open
      payDay = addDays(now, -1);
    }
    const partial = r() < 0.08 && b.dueDate >= addDays(now, -40); // recent bills only: older ones were settled in full
    const amount = partial ? round2(b.total * 0.5) : b.total;
    const rate = withholdingRate(v, b.subtotal);
    const withheld = round2(amount * rate);
    const method = methodFor(b.total);
    const p: BillPayment = {
      id: newId("pay"), date: payDay < b.issueDate ? b.issueDate : payDay, amount, withheld, netPaid: round2(amount - withheld), method,
      reference: method === "CASH" ? `RCPT-${between(1000, 9999)}` : `${method === "TELEBIRR" ? "TB" : "FT"}${between(10_000_000, 99_999_999)}`,
      paidBy: "EMP-002", timestamp: `${payDay}T11:30:00.000Z`,
    };
    b.payments.push(p);
  }

  /* ---------- filings: months before last are filed; last month is open (due end of this month) ---------- */
  for (let m = 0; m < 5; m++) {
    const month = monthKey(dayOf(new Date(d.getFullYear(), d.getMonth() - 5 + m, 1)));
    const last = m === 4;
    for (const kind of ["VAT", "WHT"] as const) {
      out.filings.push(last ? { month, kind, status: "OPEN" } : {
        month, kind, status: "FILED", filedBy: "EMP-020", filedAt: `${addDays(lastOfMonth(addDays(lastOfMonth(month), 1).slice(0, 7)), -between(2, 6))}T10:00:00.000Z`,
        reference: `${kind}-${month.replace("-", "")}-${between(100000, 999999)}`,
      });
    }
  }

  /* ---------- daily reconciliation for the last 30 days ---------- */
  for (const s of out.sales.filter((x) => x.date >= addDays(now, -30))) {
    const age = Math.round((parseDay(now).getTime() - parseDay(s.date).getTime()) / 86_400_000);
    const rec: Reconciliation = {
      date: s.date, cashExpected: s.byMethod.CASH, cashCounted: 0, bankDeposit: 0, bankConfirmed: false,
      telebirrExpected: s.byMethod.TELEBIRR, telebirrReceived: 0, cbeBirrExpected: s.byMethod.CBE_BIRR, cbeBirrReceived: 0, status: "PENDING", note: "",
    };
    if (age > 2) {
      const short = r() < 0.12 ? -between(150, 900) : 0;
      rec.cashCounted = round2(s.byMethod.CASH + short);
      rec.bankDeposit = round2(rec.cashCounted - DAILY_FLOAT);
      rec.bankConfirmed = true;
      const teleGap = r() < 0.06 ? -between(200, 1200) : 0;
      rec.telebirrReceived = round2(s.byMethod.TELEBIRR + teleGap);
      rec.cbeBirrReceived = s.byMethod.CBE_BIRR;
      rec.status = short || teleGap ? "VARIANCE" : "MATCHED";
      rec.note = short ? "Drawer short; cashier informed" : teleGap ? "Telebirr settlement pending from provider" : "";
      rec.reconciledBy = "EMP-020";
      rec.reconciledAt = `${addDays(s.date, 1)}T08:40:00.000Z`;
    }
    out.recon.push(rec);
  }

  return out;
}

