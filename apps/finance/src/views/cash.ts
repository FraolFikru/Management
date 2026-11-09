/* Cash flow & bank reconciliation. Balances of the safe, the CBE bank
   account and the Telebirr / CBE Birr wallets; money in and out for
   the month; and the daily match of the register's Z-report against
   cash counted, the bank deposit and mobile-money settlements. */

import type { Movement, Reconciliation } from "../types";
import { t, tk } from "../i18n";
import { addDays, fmtDay, money, today } from "../format";
import { ACCOUNT_IDS, COLORS, DAILY_FLOAT, METHOD_COLOR, RECON_TOLERANCE } from "../catalog";
import { lastOfMonth, monthKey } from "../seed";
import { balances, db, movements, state } from "../store";
import { esc, icon } from "../ui/dom";
import { bar, dayLabel, empty, monthLabel, pill, seg, stampOf } from "../ui/shared";
import { openModal } from "../ui/modal-bus";
import { rerender, type ActionMap } from "../ui/app";

const ACCT_ICON = { CASH: "drawer", BANK: "store", TELEBIRR: "phone", CBE_BIRR: "wallet" } as const;

function diff(expected: number, actual: number, done: boolean): string {
  if (!done) return `<span class="meta">—</span>`;
  const d = actual - expected;
  if (Math.abs(d) <= RECON_TOLERANCE) return `<span class="good-text">${icon("check")}</span>`;
  return `<span class="bad-text">${d > 0 ? "+" : "−"}${money(Math.abs(d), 0)}</span>`;
}

const labelOf = (m: Movement): string =>
  m.kind === "DEPOSIT" ? t(m.label)
  : m.kind === "PAYROLL" ? `${t("Payroll")} · ${monthLabel(m.label.slice(-7))}`
  : m.kind === "TAX" ? `${m.label.startsWith("VAT") ? t("VAT return") : t("Withholding return")} · ${monthLabel(m.label.slice(-7))}`
  : m.label;

const STATUS: Record<Reconciliation["status"], [string, string]> = { PENDING: ["warn", "To reconcile"], MATCHED: ["good", "Matched"], VARIANCE: ["bad", "Variance"] };

function reconTable(): string {
  const rows = [...db.recon].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<div class="table-wrap"><table class="data recon">
    <caption class="sr">${t("Daily reconciliation")}</caption>
    <thead>
      <tr><th scope="col" rowspan="2">${t("Day")}</th><th scope="colgroup" colspan="3" class="grp">${t("Cash drawer → bank")}</th>
        <th scope="colgroup" colspan="2" class="grp">${t("Telebirr")}</th><th scope="colgroup" colspan="2" class="grp">${t("CBE Birr")}</th>
        <th scope="col" rowspan="2">${t("Status")}</th><th scope="col" rowspan="2"><span class="sr">${t("Actions")}</span></th></tr>
      <tr><th scope="col" class="num">${t("Register")}</th><th scope="col" class="num">${t("Counted")}</th><th scope="col" class="num">${t("Banked")}</th>
        <th scope="col" class="num">${t("Register")}</th><th scope="col" class="num">${t("Wallet")}</th>
        <th scope="col" class="num">${t("Register")}</th><th scope="col" class="num">${t("Wallet")}</th></tr>
    </thead>
    <tbody>${rows.map((r) => {
      const done = r.status !== "PENDING";
      const [k, l] = STATUS[r.status];
      return `<tr class="${r.status === "VARIANCE" ? "var-row" : r.status === "PENDING" ? "pend-row" : ""}">
        <th scope="row" class="nowrap">${esc(dayLabel(r.date))}</th>
        <td class="num">${money(r.cashExpected, 0)}</td>
        <td class="num">${done ? money(r.cashCounted, 0) : "—"}<small>${diff(r.cashExpected, r.cashCounted, done)}</small></td>
        <td class="num">${done ? `${money(r.bankDeposit, 0)}<small>${r.bankConfirmed ? `<span class="good-text">${t("on statement")}</span>` : `<span class="warn-text">${t("not on statement")}</span>`}</small>` : "—"}</td>
        <td class="num">${money(r.telebirrExpected, 0)}</td>
        <td class="num">${done ? money(r.telebirrReceived, 0) : "—"}<small>${diff(r.telebirrExpected, r.telebirrReceived, done)}</small></td>
        <td class="num">${money(r.cbeBirrExpected, 0)}</td>
        <td class="num">${done ? money(r.cbeBirrReceived, 0) : "—"}<small>${diff(r.cbeBirrExpected, r.cbeBirrReceived, done)}</small></td>
        <td>${pill(k, t(l))}${r.note ? `<small class="sub">${esc(r.note)}</small>` : ""}${r.reconciledBy && r.reconciledAt ? `<div>${stampOf(r.reconciledBy, r.reconciledAt)}</div>` : ""}</td>
        <td><button type="button" class="btn small ${done ? "ghost" : "primary"}" data-action="recon" data-value="${r.date}">${done ? t("Review") : t("Reconcile")}</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

export function renderCash(): string {
  const bal = balances();
  const yday = balances(addDays(today(), -1));
  const month = state.cashMonth;
  const from = `${month}-01`, to = lastOfMonth(month);
  const mv = movements().filter((m) => m.date >= from && m.date <= to && m.kind !== "DEPOSIT");
  const sum = (f: (m: (typeof mv)[number]) => boolean): number => mv.filter(f).reduce((s, m) => s + m.amount, 0);
  const inflows: [string, number, string][] = [
    [t("Cash sales"), sum((m) => m.kind === "SALES" && m.account === "CASH"), METHOD_COLOR.CASH],
    [t("Telebirr sales"), sum((m) => m.kind === "SALES" && m.account === "TELEBIRR"), METHOD_COLOR.TELEBIRR],
    [t("CBE Birr sales"), sum((m) => m.kind === "SALES" && m.account === "CBE_BIRR"), METHOD_COLOR.CBE_BIRR],
  ];
  const outflows: [string, number, string][] = [
    [t("Supplier payments"), -sum((m) => m.kind === "VENDOR"), COLORS[3]],
    [t("Payroll"), -sum((m) => m.kind === "PAYROLL"), COLORS[1]],
    [t("Tax payments"), -sum((m) => m.kind === "TAX"), COLORS[4]],
  ];
  const tin = inflows.reduce((s, x) => s + x[1], 0);
  const tout = outflows.reduce((s, x) => s + x[1], 0);
  const max = Math.max(tin, tout, 1);
  const pending = db.recon.filter((r) => r.status === "PENDING").length;
  const variance = db.recon.filter((r) => r.status === "VARIANCE");
  const monthsList = [monthKey(addDays(`${monthKey(addDays(`${monthKey(today())}-01`, -1))}-01`, -1)), monthKey(addDays(`${monthKey(today())}-01`, -1)), monthKey(today())];
  const recent = movements().filter((m) => m.kind !== "SALES" && !(m.kind === "DEPOSIT" && m.account !== "BANK")).slice(-12).reverse();
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Cash & reconciliation")}</h1>
      <p>${t("Match each day's register against the cash counted, the bank deposit and the Telebirr / CBE Birr wallets.")}</p></div></div>
    <section class="metrics"><h2 class="sr">${t("Balances")}</h2><div class="metric-grid">${ACCOUNT_IDS.map((a) => {
      const ch = bal[a] - yday[a];
      return `<article class="metric acct"><div class="metric-top"><span>${esc(tk(`acct.${a}`))}</span><span class="metric-ic">${icon(ACCT_ICON[a])}</span></div>
        <div class="metric-value ${bal[a] < 0 ? "bad-text" : ""}">${money(bal[a], 0)}</div>
        <div class="metric-foot"><span class="chip ${ch >= 0 ? "good" : "bad"}">${ch >= 0 ? "+" : "−"}${money(Math.abs(ch), 0)}</span><span>${t("since yesterday")}</span></div></article>`;
    }).join("")}</div></section>
    <div class="grid-2">
      <section class="card" aria-labelledby="cfTitle">
        <div class="card-head"><div><h2 id="cfTitle">${t("Cash flow")}</h2><p>${esc(monthLabel(month))}${to > today() ? ` · ${t("to date")}` : ""}</p></div>
          ${seg("cash-month", month, monthsList.map((m) => [m, monthLabel(m)] as const), t("Month"), "small")}</div>
        <h3 class="mini-head">${t("Money in")} <span class="num good-text">${money(tin, 0)}</span></h3>
        <div class="bar-list">${inflows.map(([l, v, c]) => bar(l, v, max, c)).join("")}</div>
        <h3 class="mini-head">${t("Money out")} <span class="num bad-text">${money(tout, 0)}</span></h3>
        <div class="bar-list">${outflows.map(([l, v, c]) => bar(l, v, max, c)).join("")}</div>
        <p class="net-flow">${t("Net cash flow")} <strong class="${tin - tout >= 0 ? "good-text" : "bad-text"}">${tin - tout >= 0 ? "+" : "−"}${money(Math.abs(tin - tout), 0)}</strong></p>
      </section>
      <section class="card" aria-labelledby="mvTitle">
        <div class="card-head"><div><h2 id="mvTitle">${t("Recent movements")}</h2><p>${t("Deposits, supplier payments, payroll and tax")}</p></div></div>
        ${recent.length ? `<ul class="mv-list">${recent.map((m) => `<li class="row-hover"><span><strong>${esc(labelOf(m))}</strong><small>${esc(tk(`acct.${m.account}`))} · ${esc(fmtDay(m.date))}</small></span>
          <span class="num ${m.amount >= 0 ? "good-text" : ""}">${m.amount >= 0 ? "+" : "−"}${money(Math.abs(m.amount), 0)}</span></li>`).join("")}</ul>` : empty(t("No movements yet"))}
      </section>
    </div>
    <section class="card" aria-labelledby="rcTitle">
      <div class="card-head"><div><h2 id="rcTitle">${t("Daily reconciliation")}</h2>
        <p>${t("{p} days to reconcile · {v} with a variance", { p: pending, v: variance.length })} · ${t("{x} kept in the safe each day for petty payments", { x: money(DAILY_FLOAT, 0) })}</p></div></div>
      ${reconTable()}
    </section>`;
}

export const cashActions: ActionMap = {
  "cash-month": (el) => { const v = el.dataset.value ?? ""; if (/^\d{4}-\d{2}$/.test(v)) { state.cashMonth = v; rerender(`[data-action="cash-month"][data-value="${v}"]`); } },
  recon: (el) => openModal({ kind: "recon", date: el.dataset.value ?? "" }, el),
};
