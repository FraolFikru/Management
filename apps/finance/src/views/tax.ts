/* Tax & VAT ledger: output VAT collected on sales, deductible input
   VAT on supplier bills (VAT-registered supplier + receipt on file),
   VAT blocked for missing receipts, net VAT payable, and withholding
   kept back from supplier payments. Monthly returns are due by the
   last day of the following month; mark them filed with a reference. */

import { t } from "../i18n";
import { addDays, daysBetween, fmtDay, money, today } from "../format";
import { WHT_RATE, WHT_THRESHOLD } from "../catalog";
import { lastOfMonth, monthKey, vendorById } from "../seed";
import { db, deductibleVat, filing, filingDue, reopenReturn, state, user, vatSummary } from "../store";
import { esc, icon } from "../ui/dom";
import { empty, monthLabel, pill, seg, stampOf } from "../ui/shared";
import { openModal } from "../ui/modal-bus";
import { rerender, type ActionMap } from "../ui/app";
import { toast } from "../ui/toast";

type Kind = "ALL" | "OUTPUT" | "INPUT" | "WHT";
let kind: Kind = "ALL";

/** The current month and the three before it (within the books). */
export const months = (): string[] => {
  const out: string[] = [];
  let m = monthKey(today());
  for (let i = 0; i < 4 && `${m}-01` >= monthKey(db.start) + "-01"; i++) { out.unshift(m); m = monthKey(addDays(`${m}-01`, -1)); }
  return out;
};

function filingCard(month: string, k: "VAT" | "WHT", amount: number): string {
  const f = filing(month, k);
  const due = filingDue(month);
  const notEnded = lastOfMonth(month) >= today();
  const late = f.status === "OPEN" && due < today();
  const days = daysBetween(today(), due);
  const status = f.status === "FILED" ? pill("good", t("Filed")) : late ? pill("bad", t("Late")) : notEnded ? pill("muted", t("Month in progress")) : pill("warn", t("To file"));
  return `<div class="filing ${f.status === "FILED" ? "ok" : late ? "late" : ""}">
    <div class="filing-top"><strong>${k === "VAT" ? t("VAT return") : t("Withholding return")}</strong>${status}</div>
    <div class="filing-amt num">${money(Math.max(0, amount), 0)}</div>
    <p class="meta">${amount < 0 ? t("Credit of {x} carried forward", { x: money(-amount, 0) }) : f.status === "FILED" ? t("Paid to the tax office") : t("Payable to the tax office")}</p>
    ${f.status === "FILED" && f.filedBy && f.filedAt ? `<p class="meta">${stampOf(f.filedBy, f.filedAt, t("Filed by"))}<br><span class="mono">${esc(f.reference ?? "")}</span></p>
      <button type="button" class="btn small ghost" data-action="reopen-return" data-value="${month}|${k}">${t("Undo filing")}</button>`
      : `<p class="meta">${t("Due {d}", { d: fmtDay(due) })} · ${late ? `<span class="bad-text">${t("{n} days late", { n: -days })}</span>` : t("{n} days left", { n: days })}</p>
      <button type="button" class="btn small ${notEnded ? "ghost" : "primary"}" data-action="file-return" data-value="${month}|${k}" ${notEnded ? "disabled" : ""}>${icon("check")} ${t("Mark as filed")}</button>`}
  </div>`;
}

function ledger(month: string): string {
  const from = `${month}-01`, to = lastOfMonth(month);
  type Row = { date: string; kind: Exclude<Kind, "ALL">; label: string; base: number; tax: number; note: string };
  const rows: Row[] = [];
  if (kind === "ALL" || kind === "OUTPUT") for (const s of db.sales) if (s.date >= from && s.date <= to) rows.push({ date: s.date, kind: "OUTPUT", label: t("Sales Z-report"), base: s.gross - s.vat, tax: s.vat, note: "" });
  if (kind === "ALL" || kind === "INPUT") for (const b of db.bills) if (b.issueDate >= from && b.issueDate <= to && b.vat) {
    const ded = deductibleVat(b);
    rows.push({ date: b.issueDate, kind: "INPUT", label: `${vendorById(b.vendorId)?.name ?? ""} · ${b.billNo}`, base: b.subtotal, tax: b.vat, note: ded ? "" : t("No receipt — not deductible") });
  }
  if (kind === "ALL" || kind === "WHT") for (const b of db.bills) for (const p of b.payments) if (p.withheld && p.date >= from && p.date <= to) {
    rows.push({ date: p.date, kind: "WHT", label: `${vendorById(b.vendorId)?.name ?? ""} · ${b.billNo}`, base: p.amount, tax: p.withheld, note: vendorById(b.vendorId)?.tin ? "3%" : t("30% — no TIN") });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!rows.length) return empty(t("No entries for this month"));
  const KIND: Record<Row["kind"], [string, string]> = { OUTPUT: ["good", t("Output VAT")], INPUT: ["break", t("Input VAT")], WHT: ["warn", t("Withholding")] };
  return `<div class="table-wrap"><table class="data ledger">
    <caption class="sr">${t("Tax ledger")}</caption>
    <thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("Type")}</th><th scope="col">${t("Source")}</th><th scope="col" class="num">${t("Taxable amount")}</th><th scope="col" class="num">${t("Tax")}</th></tr></thead>
    <tbody>${rows.slice(0, 120).map((r) => `<tr class="${r.note && r.kind === "INPUT" ? "blocked" : ""}">
      <td class="nowrap">${esc(fmtDay(r.date))}</td><td>${pill(KIND[r.kind][0], KIND[r.kind][1])}</td>
      <th scope="row">${esc(r.label)}${r.note ? `<small class="sub ${r.kind === "INPUT" ? "warn-text" : ""}">${esc(r.note)}</small>` : ""}</th>
      <td class="num">${money(r.base, 0)}</td><td class="num strong">${money(r.tax, 2)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function renderTax(): string {
  const month = state.taxMonth;
  const v = vatSummary(month);
  const history = [...new Set(db.filings.map((f) => f.month))].sort().reverse();
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Tax & VAT")}</h1>
      <p>${t("VAT 15% on sales, minus VAT paid to VAT-registered suppliers (with a receipt). Withholding: {p}% on goods ≥ {g} and services ≥ {s}.", { p: WHT_RATE * 100, g: money(WHT_THRESHOLD.GOODS, 0), s: money(WHT_THRESHOLD.SERVICES, 0) })}</p></div>
      <div class="head-controls">${seg("tax-month", month, months().map((m) => [m, m === monthKey(today()) ? `${monthLabel(m)} · ${t("to date")}` : monthLabel(m)] as const), t("Month"), "small")}</div></div>
    <div class="tax-layout">
      <section class="card vat-return" aria-labelledby="vrTitle">
        <div class="card-head"><div><h2 id="vrTitle">${t("VAT summary · {m}", { m: monthLabel(month) })}</h2><p>${v.partial ? t("Month in progress — figures so far.") : t("Ready to file.")}</p></div></div>
        <dl class="vat-lines">
          <div><dt>${t("Taxable sales (excl. VAT)")}</dt><dd>${money(v.salesNet, 0)}</dd></div>
          <div class="hl good"><dt>${t("Output VAT collected")}</dt><dd>${money(v.output, 2)}</dd></div>
          <div class="hl"><dt>${t("Input VAT deductible")}</dt><dd>− ${money(v.input, 2)}</dd></div>
          ${v.blocked ? `<div class="warn"><dt>${t("VAT not deductible (no receipt)")}</dt><dd>${money(v.blocked, 2)}</dd></div>` : ""}
          <div class="total"><dt>${v.net >= 0 ? t("Net VAT payable") : t("VAT credit")}</dt><dd>${money(Math.abs(v.net), 2)}</dd></div>
          <div><dt>${t("Withholding kept from suppliers")}</dt><dd>${money(v.withheld, 2)}</dd></div>
        </dl>
      </section>
      <div class="filings">${filingCard(month, "VAT", v.net)}${filingCard(month, "WHT", v.withheld)}</div>
    </div>
    <section class="card" aria-labelledby="lgTitle">
      <div class="card-head"><div><h2 id="lgTitle">${t("Ledger")}</h2><p>${t("Every taxable line for {m}", { m: monthLabel(month) })}</p></div>
        ${seg("tax-kind", kind, [["ALL", t("All")], ["OUTPUT", t("Output VAT")], ["INPUT", t("Input VAT")], ["WHT", t("Withholding")]], t("Type"), "small")}</div>
      ${ledger(month)}
    </section>
    <section class="card" aria-labelledby="fhTitle">
      <div class="card-head"><div><h2 id="fhTitle">${t("Filing history")}</h2></div></div>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th scope="col">${t("Month")}</th><th scope="col">${t("VAT")}</th><th scope="col">${t("Withholding")}</th><th scope="col">${t("Due")}</th></tr></thead>
        <tbody>${history.map((m) => {
          const cell = (k: "VAT" | "WHT"): string => {
            const f = filing(m, k);
            const amt = k === "VAT" ? vatSummary(m).net : vatSummary(m).withheld;
            return `${f.status === "FILED" ? pill("good", t("Filed")) : filingDue(m) < today() ? pill("bad", t("Late")) : pill("warn", t("To file"))} <span class="num">${money(Math.max(0, amt), 0)}</span>${f.reference ? `<small class="sub mono">${esc(f.reference)}</small>` : ""}`;
          };
          return `<tr><th scope="row"><button type="button" class="link-btn" data-action="tax-month" data-value="${m}">${esc(monthLabel(m))}</button></th><td>${cell("VAT")}</td><td>${cell("WHT")}</td><td class="nowrap">${esc(fmtDay(filingDue(m)))}</td></tr>`;
        }).join("")}</tbody></table></div>
    </section>`;
}

export const taxActions: ActionMap = {
  "tax-month": (el) => { const v = el.dataset.value ?? ""; if (/^\d{4}-\d{2}$/.test(v)) { state.taxMonth = v; rerender(`[data-action="tax-month"][data-value="${v}"]`); } },
  "tax-kind": (el) => { const v = el.dataset.value; kind = v === "OUTPUT" || v === "INPUT" || v === "WHT" ? v : "ALL"; rerender(`[data-action="tax-kind"][data-value="${kind}"]`); },
  "file-return": (el) => {
    const [month, k] = (el.dataset.value ?? "").split("|");
    if (k === "VAT" || k === "WHT") openModal({ kind: "file", month, tax: k }, el);
  },
  "reopen-return": (el) => {
    const [month, k] = (el.dataset.value ?? "").split("|");
    if (k !== "VAT" && k !== "WHT") return;
    const before = { ...filing(month, k) };
    reopenReturn(month, k);
    rerender(`[data-action="file-return"][data-value="${month}|${k}"]`);
    toast(t("{k} return for {m} reopened · by {name}", { k, m: monthLabel(month), name: user().name }), () => { Object.assign(filing(month, k), before); rerender(); });
  },
};
