/* Dialogs: pay a bill, enter a new bill, reconcile a day, file a tax
   return. Focus is trapped inside and returned to the opener; Escape
   closes. Every save is stamped and can be undone from the toast. */

import type { FieldErrors, PaymentMethod } from "../types";
import { t, tk } from "../i18n";
import { addDays, fmtDay, money, parseAmount, plain, round2, today } from "../format";
import { DAILY_FLOAT, METHOD_ACCOUNT, METHOD_IDS, RECON_TOLERANCE, VAT_RATE, catName, isMethod } from "../catalog";
import { vendorById, withholdingRate } from "../seed";
import {
  addBill, balanceOf, balances, db, fileReturn, filing, payBill, reconStatus, removeBill, reopenReturn, saveRecon, state, unpay, user, vatSummary, type Modal,
} from "../store";
import { $, $$, esc, icon } from "../ui/dom";
import { clearErrors, dayLabel, errText, invalid, monthLabel, setPressed, showErrors } from "../ui/shared";
import { registerModalOpener } from "../ui/modal-bus";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

let opener: HTMLElement | null = null;

interface PayDraft { amount: string; method: PaymentMethod; reference: string; date: string }
let pd: PayDraft = { amount: "", method: "CBE_BIRR", reference: "", date: today() };
interface BillDraft { vendorId: string; billNo: string; description: string; issueDate: string; dueDate: string; subtotal: string; hasReceipt: boolean }
let bd: BillDraft = { vendorId: "", billNo: "", description: "", issueDate: today(), dueDate: "", subtotal: "", hasReceipt: true };
interface ReconDraft { cashCounted: string; bankDeposit: string; bankConfirmed: boolean; telebirrReceived: string; cbeBirrReceived: string; note: string }
let rd: ReconDraft = { cashCounted: "", bankDeposit: "", bankConfirmed: false, telebirrReceived: "", cbeBirrReceived: "", note: "" };
let fileRef = "";

export function openModal(m: Exclude<Modal, null>, from: HTMLElement): void {
  opener = from;
  state.modal = m;
  state.errors = {};
  if (m.kind === "pay") {
    const b = db.bills.find((x) => x.id === m.billId);
    const bal = b ? balanceOf(b) : 0;
    pd = { amount: plain(bal), method: bal < 15000 ? "CASH" : bal < 45000 ? "TELEBIRR" : "CBE_BIRR", reference: "", date: today() };
  } else if (m.kind === "bill") bd = { vendorId: "", billNo: "", description: "", issueDate: today(), dueDate: "", subtotal: "", hasReceipt: true };
  else if (m.kind === "recon") {
    const r = db.recon.find((x) => x.date === m.date);
    if (r) rd = r.status === "PENDING"
      ? { cashCounted: "", bankDeposit: "", bankConfirmed: false, telebirrReceived: "", cbeBirrReceived: "", note: "" }
      : { cashCounted: plain(r.cashCounted), bankDeposit: plain(r.bankDeposit), bankConfirmed: r.bankConfirmed, telebirrReceived: plain(r.telebirrReceived), cbeBirrReceived: plain(r.cbeBirrReceived), note: r.note };
  } else fileRef = "";
  renderModal();
}
registerModalOpener(openModal);

export function closeModal(): void {
  state.modal = null;
  state.errors = {};
  const root = $("#modalRoot");
  if (root) root.innerHTML = "";
  document.body.classList.remove("modal-open");
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

const foot = (submit: string, danger = false): string => `<div class="modal-foot">
  <small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().name), id: esc(user().id) })}</small>
  <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
    <button type="submit" class="btn ${danger ? "danger" : "primary"}">${icon("check")} ${submit}</button></div></div>`;

/* ---------- pay a bill ---------- */

function payPreview(): string {
  const m = state.modal;
  if (!m || m.kind !== "pay") return "";
  const b = db.bills.find((x) => x.id === m.billId);
  const v = b ? vendorById(b.vendorId) : undefined;
  if (!b || !v) return "";
  const amt = Math.min(parseAmount(pd.amount) || 0, balanceOf(b));
  const rate = withholdingRate(v, b.subtotal);
  const wht = round2(amt * rate);
  const acct = METHOD_ACCOUNT[pd.method];
  const avail = balances()[acct];
  return `<dl class="pay-preview">
    <div><dt>${t("Settles")}</dt><dd>${money(amt, 2)}</dd></div>
    <div><dt>${rate ? t("Withholding {p}% (paid to tax office)", { p: Math.round(rate * 100) }) : t("Withholding")}</dt><dd>${rate ? `− ${money(wht, 2)}` : t("not required")}</dd></div>
    <div class="total"><dt>${t("Paid to supplier")}</dt><dd>${money(amt - wht, 2)}</dd></div>
    <div><dt>${esc(tk(`acct.${acct}`))}</dt><dd class="${avail < amt - wht ? "bad-text" : ""}">${t("{x} available", { x: money(avail, 0) })}</dd></div>
  </dl>`;
}

function payForm(billId: string): string {
  const b = db.bills.find((x) => x.id === billId);
  const v = b ? vendorById(b.vendorId) : undefined;
  if (!b || !v) return "";
  const e: FieldErrors = state.errors;
  return `<form id="payForm" class="form" novalidate>
    <p class="modal-summary"><strong>${esc(v.name)}</strong> · ${esc(b.billNo)}<br>${esc(b.description)} · ${t("due {d}", { d: fmtDay(b.dueDate) })} · ${t("balance {x}", { x: money(balanceOf(b), 2) })}</p>
    <div class="row">
      <div class="field"><label for="pAmt">${t("Amount to settle")}</label>
        <div class="affix"><span>ETB</span><input id="pAmt" class="input num-in" inputmode="decimal" value="${esc(pd.amount)}" data-bind="pay.amount" ${invalid(e, "amount")}></div>${errText(e, "amount")}</div>
      <div class="field"><label for="pDate">${t("Payment date")}</label><input id="pDate" class="input" type="date" max="${today()}" min="${b.issueDate}" value="${esc(pd.date)}" data-bind="pay.date"></div>
    </div>
    <div class="field"><span class="label" id="pmLbl">${t("Paid with")}</span>
      <div class="pay-grid three" role="group" aria-labelledby="pmLbl">${METHOD_IDS.map((m) => `<button type="button" class="pay-opt" data-action="pay-method" data-value="${m}" aria-pressed="${pd.method === m}"><strong>${esc(tk(`pay.${m}`))}</strong></button>`).join("")}</div></div>
    <div class="field"><label for="pRef">${pd.method === "CASH" ? t("Receipt number") : t("Transaction ID")}</label>
      <input id="pRef" class="input" autocomplete="off" placeholder="${pd.method === "CASH" ? "RCPT-1234" : pd.method === "TELEBIRR" ? "TB12345678" : "FT12345678"}" value="${esc(pd.reference)}" data-bind="pay.reference" ${invalid(e, "reference")}>${errText(e, "reference")}</div>
    <div id="payPreview">${payPreview()}</div>
    ${foot(t("Record payment"))}
  </form>`;
}

function submitPay(): void {
  const m = state.modal;
  if (!m || m.kind !== "pay") return;
  const b = db.bills.find((x) => x.id === m.billId);
  if (!b) return;
  const amt = parseAmount(pd.amount);
  const errors: FieldErrors = {};
  if (!(amt > 0)) errors.amount = t("Enter an amount above 0.");
  else if (amt > balanceOf(b) + 0.005) errors.amount = t("More than the balance of {x}.", { x: money(balanceOf(b), 2) });
  if (pd.reference.trim().length < 4) errors.reference = t("Enter the receipt or transaction number.");
  if (showErrors(errors, ["amount", "reference"])) return;
  const p = payBill(b.id, amt, pd.method, pd.reference.trim(), pd.date || today());
  closeModal();
  if (!p) return;
  state.apOpen = b.id;
  rerender();
  toast(t("Paid {x} to {v} by {m}{w} · by {name}", {
    x: money(p.netPaid, 2), v: vendorById(b.vendorId)?.name ?? "", m: tk(`pay.${p.method}`), name: user().name,
    w: p.withheld ? ` · ${t("{x} withheld", { x: money(p.withheld, 2) })}` : "",
  }), () => { unpay(b.id, p.id); rerender(); });
}

/* ---------- new bill ---------- */

function billForm(): string {
  const e: FieldErrors = state.errors;
  const v = vendorById(bd.vendorId);
  const sub = parseAmount(bd.subtotal) || 0;
  const vat = v?.vatRegistered ? sub * VAT_RATE : 0;
  return `<form id="billForm" class="form" novalidate>
    <div class="field"><label for="bVendor">${t("Supplier")}</label>
      <select id="bVendor" class="input" data-bind="bill.vendorId" ${invalid(e, "vendor")}><option value="">${t("Choose…")}</option>${db.vendors.map((x) =>
        `<option value="${x.id}" ${bd.vendorId === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      ${v ? `<p class="hint">${esc(tk(catName(v.category)))} · ${t("terms {n} days", { n: v.termsDays })} · ${v.vatRegistered ? t("charges VAT") : t("not VAT-registered")}${v.tin ? ` · TIN ${esc(v.tin)}` : ` · <span class="warn-text">${t("no TIN")}</span>`}</p>` : ""}
      ${errText(e, "vendor")}</div>
    <div class="row">
      <div class="field"><label for="bNo">${t("Bill / invoice number")}</label><input id="bNo" class="input" autocomplete="off" value="${esc(bd.billNo)}" data-bind="bill.billNo" ${invalid(e, "billNo")}>${errText(e, "billNo")}</div>
      <div class="field"><label for="bDesc">${t("What for")}</label><input id="bDesc" class="input" autocomplete="off" placeholder="${t("e.g. vegetables for the week")}" value="${esc(bd.description)}" data-bind="bill.description"></div>
    </div>
    <div class="row">
      <div class="field"><label for="bIssue">${t("Bill date")}</label><input id="bIssue" class="input" type="date" max="${today()}" value="${esc(bd.issueDate)}" data-bind="bill.issueDate"></div>
      <div class="field"><label for="bDue">${t("Due date")}</label><input id="bDue" class="input" type="date" value="${esc(bd.dueDate || (v ? addDays(bd.issueDate, v.termsDays) : ""))}" data-bind="bill.dueDate"></div>
    </div>
    <div class="row">
      <div class="field"><label for="bSub">${t("Amount before VAT")}</label>
        <div class="affix"><span>ETB</span><input id="bSub" class="input num-in" inputmode="decimal" value="${esc(bd.subtotal)}" data-bind="bill.subtotal" ${invalid(e, "subtotal")}></div>${errText(e, "subtotal")}</div>
      <div class="field"><span class="label">${t("Bill total")}</span><p class="calc" id="bTotal">${money(sub + vat, 2)}<small>${v?.vatRegistered ? t("incl. VAT {x}", { x: money(vat, 2) }) : t("no VAT")}</small></p></div>
    </div>
    ${v?.vatRegistered ? `<label class="check-line"><input type="checkbox" data-bind="bill.hasReceipt" ${bd.hasReceipt ? "checked" : ""}> ${t("VAT receipt received (needed to claim the input VAT)")}</label>` : ""}
    ${foot(t("Save bill"))}
  </form>`;
}

function refreshBillTotal(): void {
  const v = vendorById(bd.vendorId);
  const sub = parseAmount(bd.subtotal) || 0;
  const vat = v?.vatRegistered ? sub * VAT_RATE : 0;
  const el = $("#bTotal");
  if (el) el.innerHTML = `${money(sub + vat, 2)}<small>${v?.vatRegistered ? t("incl. VAT {x}", { x: money(vat, 2) }) : t("no VAT")}</small>`;
}

function submitBill(): void {
  const v = vendorById(bd.vendorId);
  const sub = parseAmount(bd.subtotal);
  const errors: FieldErrors = {};
  if (!v) errors.vendor = t("Choose the supplier.");
  if (!bd.billNo.trim()) errors.billNo = t("Enter the bill number.");
  else if (db.bills.some((b) => b.vendorId === bd.vendorId && b.billNo.toLowerCase() === bd.billNo.trim().toLowerCase())) errors.billNo = t("This supplier already has a bill with that number.");
  if (!(sub > 0)) errors.subtotal = t("Enter an amount above 0.");
  if (showErrors(errors, ["vendor", "billNo", "subtotal"]) || !v) return;
  const b = addBill({
    vendorId: v.id, billNo: bd.billNo.trim(), description: bd.description.trim() || tk(catName(v.category)), category: v.category, issueDate: bd.issueDate || today(),
    dueDate: bd.dueDate || addDays(bd.issueDate || today(), v.termsDays), subtotal: round2(sub), hasReceipt: v.vatRegistered ? bd.hasReceipt : true,
  });
  closeModal();
  state.apFilter = "OUTSTANDING";
  rerender();
  toast(t("Bill {no} from {v} saved · {x} · by {name}", { no: b.billNo, v: v.name, x: money(b.total, 2), name: user().name }), () => { removeBill(b.id); rerender(); });
}

/* ---------- reconcile a day ---------- */

function reconDiffs(date: string): string {
  const r = db.recon.find((x) => x.date === date);
  if (!r) return "";
  const n = (s: string): number => parseAmount(s) || 0;
  const line = (label: string, expected: number, actual: string): string => {
    if (!actual.trim()) return `<div><dt>${label}</dt><dd class="meta">—</dd></div>`;
    const d = n(actual) - expected;
    return `<div><dt>${label}</dt><dd class="${Math.abs(d) <= RECON_TOLERANCE ? "good-text" : "bad-text"}">${Math.abs(d) <= RECON_TOLERANCE ? t("matches") : `${d > 0 ? "+" : "−"}${money(Math.abs(d), 2)}`}</dd></div>`;
  };
  return `<dl class="pay-preview">
    ${line(t("Cash counted vs register"), r.cashExpected, rd.cashCounted)}
    ${line(t("Banked vs counted − float"), rd.cashCounted.trim() ? n(rd.cashCounted) - DAILY_FLOAT : r.cashExpected - DAILY_FLOAT, rd.bankDeposit)}
    ${line(t("Telebirr wallet vs register"), r.telebirrExpected, rd.telebirrReceived)}
    ${line(t("CBE Birr wallet vs register"), r.cbeBirrExpected, rd.cbeBirrReceived)}
  </dl>`;
}

function reconForm(date: string): string {
  const r = db.recon.find((x) => x.date === date);
  if (!r) return "";
  const e: FieldErrors = state.errors;
  const fld = (id: string, key: keyof ReconDraft, label: string, expected: number, hint: string): string => `<div class="field"><label for="${id}">${label}</label>
    <div class="affix"><span>ETB</span><input id="${id}" class="input num-in" inputmode="decimal" placeholder="${plain(expected)}" value="${esc(String(rd[key]))}" data-bind="recon.${key}" ${invalid(e, key)}></div>
    <p class="hint">${hint}</p>${errText(e, key)}</div>`;
  return `<form id="reconForm" class="form" novalidate>
    <p class="modal-summary">${t("Register Z-report for {d}", { d: dayLabel(date) })}: <strong>${money(r.cashExpected + r.telebirrExpected + r.cbeBirrExpected, 2)}</strong></p>
    <div class="row">
      ${fld("rCash", "cashCounted", t("Cash counted"), r.cashExpected, t("Register says {x}", { x: money(r.cashExpected, 2) }))}
      ${fld("rBank", "bankDeposit", t("Deposited at CBE"), r.cashExpected - DAILY_FLOAT, t("Counted minus {x} float", { x: money(DAILY_FLOAT, 0) }))}
    </div>
    <label class="check-line"><input type="checkbox" data-bind="recon.bankConfirmed" ${rd.bankConfirmed ? "checked" : ""}> ${t("Deposit appears on the CBE bank statement")}</label>
    <div class="row">
      ${fld("rTele", "telebirrReceived", t("Telebirr wallet received"), r.telebirrExpected, t("Register says {x}", { x: money(r.telebirrExpected, 2) }))}
      ${fld("rCbe", "cbeBirrReceived", t("CBE Birr wallet received"), r.cbeBirrExpected, t("Register says {x}", { x: money(r.cbeBirrExpected, 2) }))}
    </div>
    <div id="reconDiffs">${reconDiffs(date)}</div>
    <div class="field"><label for="rNote">${t("Note")} <span class="opt-label">${t("(required if anything differs)")}</span></label>
      <input id="rNote" class="input" autocomplete="off" placeholder="${t("e.g. drawer short, cashier informed")}" value="${esc(rd.note)}" data-bind="recon.note" ${invalid(e, "note")}>${errText(e, "note")}</div>
    ${foot(t("Save reconciliation"))}
  </form>`;
}

function submitRecon(): void {
  const m = state.modal;
  if (!m || m.kind !== "recon") return;
  const r = db.recon.find((x) => x.date === m.date);
  if (!r) return;
  const errors: FieldErrors = {};
  const vals = {} as Record<"cashCounted" | "bankDeposit" | "telebirrReceived" | "cbeBirrReceived", number>;
  for (const k of ["cashCounted", "bankDeposit", "telebirrReceived", "cbeBirrReceived"] as const) {
    const v = parseAmount(rd[k]);
    if (!(v >= 0)) errors[k] = t("Enter the amount (0 if none).");
    else vals[k] = round2(v);
  }
  if (!Object.keys(errors).length) {
    const status = reconStatus({ ...r, ...vals, bankConfirmed: rd.bankConfirmed });
    if (status === "VARIANCE" && rd.note.trim().length < 4) errors.note = t("Explain the difference.");
  }
  if (showErrors(errors, ["cashCounted", "bankDeposit", "telebirrReceived", "cbeBirrReceived", "note"])) return;
  const before = { ...r };
  const saved = saveRecon(r.date, { ...vals, bankConfirmed: rd.bankConfirmed, note: rd.note.trim() });
  closeModal();
  if (!saved) return;
  rerender();
  toast(saved.status === "MATCHED" ? t("{d} reconciled — everything matches · by {name}", { d: dayLabel(saved.date), name: user().name })
    : t("{d} saved with a variance · by {name}", { d: dayLabel(saved.date), name: user().name }), () => { Object.assign(r, before); rerender(); });
}

/* ---------- file a return ---------- */

function fileForm(month: string, kind: "VAT" | "WHT"): string {
  const v = vatSummary(month);
  const amt = kind === "VAT" ? v.net : v.withheld;
  const e: FieldErrors = state.errors;
  return `<form id="fileForm" class="form" novalidate>
    <p class="modal-summary">${kind === "VAT" ? t("VAT return") : t("Withholding return")} · <strong>${esc(monthLabel(month))}</strong><br>
      ${amt >= 0 ? t("Amount payable") : t("VAT credit")}: <strong>${money(Math.abs(amt), 2)}</strong> · ${t("paid from the CBE bank account")}</p>
    <div class="field"><label for="fRef">${t("Filing / receipt reference")}</label>
      <input id="fRef" class="input" autocomplete="off" placeholder="${kind}-${month.replace("-", "")}-123456" value="${esc(fileRef)}" data-bind="file.ref" ${invalid(e, "ref")}>${errText(e, "ref")}</div>
    ${foot(t("Mark as filed"))}
  </form>`;
}

function submitFile(): void {
  const m = state.modal;
  if (!m || m.kind !== "file") return;
  if (fileRef.trim().length < 4) { showErrors({ ref: t("Enter the reference from the tax office receipt.") }, ["ref"]); return; }
  const before = { ...filing(m.month, m.tax) };
  fileReturn(m.month, m.tax, fileRef.trim());
  closeModal();
  rerender(`[data-action="reopen-return"][data-value="${m.month}|${m.tax}"]`);
  toast(t("{k} return for {m} marked filed · by {name}", { k: m.tax, m: monthLabel(m.month), name: user().name }), () => {
    reopenReturn(m.month, m.tax); Object.assign(filing(m.month, m.tax), before); rerender();
  });
}

/* ---------- frame & wiring ---------- */

export function renderModal(): void {
  const root = $("#modalRoot");
  const m = state.modal;
  if (!root) return;
  if (!m) { root.innerHTML = ""; return; }
  const title = m.kind === "pay" ? t("Record payment") : m.kind === "bill" ? t("New supplier bill") : m.kind === "recon" ? t("Reconcile {d}", { d: dayLabel(m.date) }) : t("Mark return as filed");
  const body = m.kind === "pay" ? payForm(m.billId) : m.kind === "bill" ? billForm() : m.kind === "recon" ? reconForm(m.date) : fileForm(m.month, m.tax);
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-close"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head"><h2 id="modalTitle">${title}</h2><button type="button" class="btn icon-btn ghost" data-action="modal-close" aria-label="${t("Close")}">${icon("x")}</button></div>
      ${body}
    </div>`;
  document.body.classList.add("modal-open");
  $<HTMLElement>(m.kind === "pay" ? "#pRef" : m.kind === "bill" ? "#bVendor" : m.kind === "recon" ? "#rCash" : "#fRef")?.focus();
}

export function onModalInput(scope: string, key: string, el: HTMLInputElement): void {
  const value = el.value;
  if (scope === "pay") {
    if (key === "amount") { pd.amount = value; clearErrors(["amount"]); }
    else if (key === "reference") { pd.reference = value; clearErrors(["reference"]); }
    else if (key === "date") pd.date = value;
    const pv = $("#payPreview"); if (pv) pv.innerHTML = payPreview();
  } else if (scope === "bill") {
    if (key === "vendorId") { bd.vendorId = value; bd.dueDate = ""; clearErrors(["vendor"]); renderModal(); $<HTMLElement>("#bVendor")?.focus(); return; }
    if (key === "hasReceipt") { bd.hasReceipt = el.checked; return; }
    if (key === "issueDate") { bd.issueDate = value; const v = vendorById(bd.vendorId); if (v && !bd.dueDate) { const d = $<HTMLInputElement>("#bDue"); if (d) d.value = addDays(value, v.termsDays); } return; }
    if (key === "billNo" || key === "description" || key === "dueDate" || key === "subtotal") bd[key] = value;
    clearErrors([key === "subtotal" ? "subtotal" : key]);
    if (key === "subtotal") refreshBillTotal();
  } else if (scope === "recon") {
    if (key === "bankConfirmed") { rd.bankConfirmed = el.checked; return; }
    if (key in rd) (rd as unknown as Record<string, string>)[key] = value;
    clearErrors([key]);
    const m = state.modal;
    const box = $("#reconDiffs");
    if (box && m && m.kind === "recon") box.innerHTML = reconDiffs(m.date);
  } else if (scope === "file") { fileRef = value; clearErrors(["ref"]); }
}

export function submitModal(formId: string): void {
  if (formId === "payForm") submitPay();
  else if (formId === "billForm") submitBill();
  else if (formId === "reconForm") submitRecon();
  else if (formId === "fileForm") submitFile();
}

export const modalActions: ActionMap = {
  "modal-close": () => closeModal(),
  "pay-method": (el) => {
    const v = el.dataset.value ?? "";
    if (!isMethod(v)) return;
    pd.method = v;
    setPressed(el);
    const lbl = $('label[for="pRef"]'); if (lbl) lbl.textContent = v === "CASH" ? t("Receipt number") : t("Transaction ID");
    const pv = $("#payPreview"); if (pv) pv.innerHTML = payPreview();
  },
};

export function modalKeydown(e: KeyboardEvent): void {
  if (!state.modal) return;
  if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
  if (e.key !== "Tab") return;
  const box = $(".modal");
  if (!box) return;
  const items = $$<HTMLElement>("a[href], button:not([disabled]), input, select, textarea", box).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
