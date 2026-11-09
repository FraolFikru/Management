/* Vendor accounts payable: outstanding bills with due dates and
   status, aging, balances per supplier, and settlement history.
   Bills are paid by Cash, Telebirr or CBE Birr; 3% withholding
   is kept back automatically where the law requires it. */

import type { Bill, BillStatus } from "../types";
import { t, tk } from "../i18n";
import { daysBetween, fmtDay, money, today } from "../format";
import { DUE_SOON_DAYS, catName } from "../catalog";
import { vendorById } from "../seed";
import { agingBuckets, balanceOf, billStatus, db, paidOn, state } from "../store";
import { esc, icon } from "../ui/dom";
import { empty, metricCard, pill, seg, stampOf } from "../ui/shared";
import { openModal } from "../ui/modal-bus";
import { rerender, type ActionMap } from "../ui/app";

const STATUS: Record<BillStatus, [string, string]> = {
  OPEN: ["muted", "Open"], PARTIAL: ["break", "Part paid"], DUE_SOON: ["warn", "Due soon"], OVERDUE: ["bad", "Overdue"], PAID: ["good", "Paid"],
};
export const statusPill = (b: Bill): string => { const [k, l] = STATUS[billStatus(b)]; return pill(k, t(l)); };

function dueText(b: Bill): string {
  if (billStatus(b) === "PAID") return esc(fmtDay(b.dueDate));
  const n = daysBetween(today(), b.dueDate);
  return `${esc(fmtDay(b.dueDate))}<small class="${n < 0 ? "bad-text" : n <= DUE_SOON_DAYS ? "warn-text" : ""}">${
    n < 0 ? t("{n} days late", { n: -n }) : n === 0 ? t("due today") : t("in {n} days", { n })}</small>`;
}

function filtered(): Bill[] {
  const f = state.apFilter;
  return db.bills
    .filter((b) => state.apVendor === "ALL" || b.vendorId === state.apVendor)
    .filter((b) => {
      const s = billStatus(b);
      return f === "ALL" || (f === "PAID" ? s === "PAID" : f === "OUTSTANDING" ? s !== "PAID" : s === f);
    })
    .sort((a, b) => (state.apFilter === "PAID" || state.apFilter === "ALL" ? (a.issueDate < b.issueDate ? 1 : -1) : a.dueDate < b.dueDate ? -1 : 1));
}

function history(b: Bill): string {
  const v = vendorById(b.vendorId);
  return `<div class="bill-detail">
    <dl class="mini">
      <div><dt>${t("Category")}</dt><dd>${esc(tk(catName(b.category)))}</dd></div>
      <div><dt>${t("Subtotal")}</dt><dd>${money(b.subtotal, 2)}</dd></div>
      <div><dt>${t("VAT 15%")}</dt><dd>${b.vat ? money(b.vat, 2) : t("Supplier not VAT-registered")}${b.vat && !b.hasReceipt ? ` <span class="warn-text">· ${t("no receipt — VAT not deductible")}</span>` : ""}</dd></div>
      <div><dt>${t("Supplier TIN")}</dt><dd>${v?.tin ? esc(v.tin) : `<span class="warn-text">${t("missing — 30% withholding")}</span>`}</dd></div>
      <div><dt>${t("Entered by")}</dt><dd>${esc(b.enteredBy)}</dd></div>
    </dl>
    <h4>${t("Settlement history")}</h4>
    ${b.payments.length ? `<table class="data compact"><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("Method")}</th><th scope="col">${t("Reference")}</th>
      <th scope="col" class="num">${t("Settled")}</th><th scope="col" class="num">${t("Withheld")}</th><th scope="col" class="num">${t("Paid out")}</th><th scope="col">${t("Paid by")}</th></tr></thead>
      <tbody>${b.payments.map((p) => `<tr><td>${esc(fmtDay(p.date))}</td><td>${esc(tk(`pay.${p.method}`))}</td><td class="mono">${esc(p.reference)}</td>
        <td class="num">${money(p.amount, 2)}</td><td class="num">${p.withheld ? money(p.withheld, 2) : "—"}</td><td class="num strong">${money(p.netPaid, 2)}</td>
        <td>${stampOf(p.paidBy, p.timestamp)}</td></tr>`).join("")}</tbody></table>` : `<p class="meta">${t("No payments yet.")}</p>`}
  </div>`;
}

function billTable(): string {
  const list = filtered();
  if (!list.length) return empty(t("No bills match"), t("Try another filter."));
  return `<div class="table-wrap"><table class="data bills">
    <caption class="sr">${t("Supplier bills")}</caption>
    <thead><tr><th scope="col">${t("Supplier · bill")}</th><th scope="col">${t("Issued")}</th><th scope="col">${t("Due")}</th>
      <th scope="col" class="num">${t("Total")}</th><th scope="col" class="num">${t("Paid")}</th><th scope="col" class="num">${t("Balance")}</th><th scope="col">${t("Status")}</th><th scope="col"><span class="sr">${t("Actions")}</span></th></tr></thead>
    <tbody>${list.slice(0, 60).map((b) => {
      const v = vendorById(b.vendorId);
      const bal = balanceOf(b);
      const open = state.apOpen === b.id;
      return `<tr class="${open ? "open" : ""}">
        <th scope="row"><button type="button" class="link-btn" data-action="ap-open" data-value="${b.id}" aria-expanded="${open}">${icon("chevr")}
          <span><strong>${esc(v?.name ?? b.vendorId)}</strong><small>${esc(b.billNo)} · ${esc(b.description)}</small></span></button></th>
        <td class="nowrap">${esc(fmtDay(b.issueDate))}</td>
        <td class="nowrap due">${dueText(b)}</td>
        <td class="num">${money(b.total, 0)}</td>
        <td class="num">${paidOn(b) ? money(paidOn(b), 0) : "—"}</td>
        <td class="num strong">${bal > 0.005 ? money(bal, 0) : "—"}</td>
        <td>${statusPill(b)}</td>
        <td>${bal > 0.005 ? `<button type="button" class="btn small primary" data-action="pay-bill" data-value="${b.id}">${t("Pay")}</button>` : ""}</td>
      </tr>
      ${open ? `<tr class="detail-row"><td colspan="8">${history(b)}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div>
    ${list.length > 60 ? `<p class="meta">${t("Showing the first 60 of {n} bills.", { n: list.length })}</p>` : ""}`;
}

export function renderPayables(): string {
  const all = db.bills;
  const outstanding = all.reduce((s, b) => s + balanceOf(b), 0);
  const overdue = all.filter((b) => billStatus(b) === "OVERDUE");
  const soon = all.filter((b) => billStatus(b) === "DUE_SOON");
  const month = today().slice(0, 7);
  const paidThisMonth = all.flatMap((b) => b.payments).filter((p) => p.date.startsWith(month));
  const ag = agingBuckets();
  const agTotal = ag.current + ag.d30 + ag.d60 + ag.d60p || 1;
  const vendors = db.vendors.map((v) => {
    const bills = all.filter((b) => b.vendorId === v.id && balanceOf(b) > 0.005);
    const next = bills.map((b) => b.dueDate).sort()[0];
    return { v, bal: bills.reduce((s, b) => s + balanceOf(b), 0), over: bills.filter((b) => billStatus(b) === "OVERDUE").reduce((s, b) => s + balanceOf(b), 0), next };
  }).filter((x) => x.bal > 0).sort((a, b) => b.over - a.over || b.bal - a.bal);
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Accounts payable")}</h1><p>${t("Supplier bills, due dates and payments by Cash, Telebirr or CBE Birr.")}</p></div>
      <div class="head-controls"><button type="button" class="btn primary" data-action="new-bill">${icon("plus")} ${t("New bill")}</button></div></div>
    <section class="metrics"><h2 class="sr">${t("Summary")}</h2><div class="metric-grid">
      ${metricCard({ icon: "receipt", title: t("Outstanding"), value: money(outstanding, 0), note: t("{n} unpaid bills", { n: all.filter((b) => balanceOf(b) > 0.005).length }) })}
      ${metricCard({ icon: "alert", title: t("Overdue"), value: money(overdue.reduce((s, b) => s + balanceOf(b), 0), 0), tone: overdue.length ? "bad" : "", note: t("{n} bills past due", { n: overdue.length }) })}
      ${metricCard({ icon: "clock", title: t("Due in 7 days"), value: money(soon.reduce((s, b) => s + balanceOf(b), 0), 0), tone: soon.length ? "warn" : "", note: t("{n} bills", { n: soon.length }) })}
      ${metricCard({ icon: "check", title: t("Paid this month"), value: money(paidThisMonth.reduce((s, p) => s + p.netPaid, 0), 0), note: t("{x} withheld for tax", { x: money(paidThisMonth.reduce((s, p) => s + p.withheld, 0), 0) }) })}
    </div></section>
    <section class="card aging" aria-labelledby="agTitle">
      <div class="card-head"><div><h2 id="agTitle">${t("Aging")}</h2><p>${t("Unpaid balance by days past due")}</p></div></div>
      <div class="aging-bar" aria-hidden="true"><i class="a0" style="flex:${ag.current}"></i><i class="a1" style="flex:${ag.d30}"></i><i class="a2" style="flex:${ag.d60}"></i><i class="a3" style="flex:${ag.d60p}"></i></div>
      <div class="aging-legend">
        <span><i class="sw a0"></i>${t("Not yet due")} <strong>${money(ag.current, 0)}</strong></span>
        <span><i class="sw a1"></i>${t("1–30 days")} <strong>${money(ag.d30, 0)}</strong></span>
        <span><i class="sw a2"></i>${t("31–60 days")} <strong>${money(ag.d60, 0)}</strong></span>
        <span><i class="sw a3"></i>${t("Over 60 days")} <strong>${money(ag.d60p, 0)}</strong></span>
        <span class="meta">${Math.round(((ag.d30 + ag.d60 + ag.d60p) / agTotal) * 100)}% ${t("is late")}</span>
      </div>
    </section>
    <div class="ap-layout">
      <section class="card" aria-labelledby="blTitle">
        <div class="card-head"><div><h2 id="blTitle">${t("Bills")}</h2></div>
          <select class="input slim" data-bind="ap.vendor" aria-label="${t("Supplier")}"><option value="ALL">${t("All suppliers")}</option>${db.vendors.map((v) =>
            `<option value="${v.id}" ${state.apVendor === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
        ${seg("ap-filter", state.apFilter, [["OUTSTANDING", t("Outstanding")], ["OVERDUE", t("Overdue")], ["DUE_SOON", t("Due soon")], ["PAID", t("Paid")], ["ALL", t("All")]], t("Status"), "small wrap")}
        ${billTable()}
      </section>
      <section class="card" aria-labelledby="vbTitle">
        <div class="card-head"><div><h2 id="vbTitle">${t("Supplier balances")}</h2><p>${t("Tap to see their bills")}</p></div></div>
        ${vendors.length ? `<ul class="vendor-list">${vendors.map(({ v, bal, over, next }) => `<li><button type="button" class="vendor-row" data-action="ap-vendor" data-value="${v.id}" aria-pressed="${state.apVendor === v.id}">
          <span><strong>${esc(v.name)}</strong><small>${esc(tk(catName(v.category)))} · ${t("terms {n} days", { n: v.termsDays })}${v.vatRegistered ? "" : ` · ${t("no VAT")}`}</small></span>
          <span class="num"><strong>${money(bal, 0)}</strong>${over ? `<small class="bad-text">${t("{x} overdue", { x: money(over, 0) })}</small>` : next ? `<small>${t("next due {d}", { d: fmtDay(next) })}</small>` : ""}</span>
        </button></li>`).join("")}</ul>` : empty(t("All suppliers are paid up"))}
      </section>
    </div>`;
}

export function onApInput(key: string, value: string): void {
  if (key === "vendor") { state.apVendor = value; state.apOpen = null; rerender("[data-bind='ap.vendor']"); }
}

export const payablesActions: ActionMap = {
  "ap-filter": (el) => {
    const v = el.dataset.value;
    state.apFilter = v === "OVERDUE" || v === "DUE_SOON" || v === "PAID" || v === "ALL" ? v : "OUTSTANDING";
    rerender(`[data-action="ap-filter"][data-value="${state.apFilter}"]`);
  },
  "ap-vendor": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.apVendor = state.apVendor === v ? "ALL" : v;
    state.apFilter = "ALL";
    rerender(`[data-action="ap-vendor"][data-value="${v}"]`);
  },
  "ap-open": (el) => {
    const id = el.dataset.value ?? "";
    state.apOpen = state.apOpen === id ? null : id;
    rerender(`[data-action="ap-open"][data-value="${id}"]`);
  },
  "pay-bill": (el) => openModal({ kind: "pay", billId: el.dataset.value ?? "" }, el),
  "new-bill": (el) => openModal({ kind: "bill" }, el),
};
