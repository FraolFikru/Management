/* Custom operational expenses: a fast form for emergency petty-cash
   runs and miscellaneous branch costs, with a free-text reason. */

import type { ExpenseSource, FieldErrors } from "../types";
import { t, tk } from "../i18n";
import { money, parseAmount, round2 } from "../format";
import { QUICK_EXPENSES, SOURCE_IDS, isSource } from "../catalog";
import { db, inPeriod, logExpense, removeExpense, state, user } from "../store";
import { $, esc, icon } from "../ui/dom";
import { clearErrors, empty, errText, invalid, periodSeg, setPressed, showErrors, stampOf } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft { reason: string; amount: string; source: ExpenseSource; note: string }
let d: Draft = { reason: "", amount: "", source: "PETTY_CASH", note: "" };

export function renderExpenses(): string {
  const e: FieldErrors = state.errors;
  const list = db.expenses.filter((x) => inPeriod(x.timestamp)).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const total = list.reduce((s, x) => s + x.amount, 0);
  const petty = list.filter((x) => x.source === "PETTY_CASH").reduce((s, x) => s + x.amount, 0);
  const past = [...new Set(db.expenses.map((x) => x.reason))];
  return `
    <div class="page-head"><div><h1>${t("Branch expenses")}</h1><p>${t("Emergency petty-cash runs and other costs that are not stock. Write the reason in your own words.")}</p></div>
      <div class="head-controls">${periodSeg()}</div></div>
    <div class="split">
      <form class="card form" id="expenseForm" novalidate aria-labelledby="xTitle">
        <h2 id="xTitle" class="sec-title">${t("Quick expense")}</h2>
        <div class="field"><label for="xReason">${t("Reason")}</label>
          <input id="xReason" class="input" list="xPast" autocomplete="off" placeholder="${t("e.g. Gas cylinder refill")}" value="${esc(d.reason)}" data-bind="expense.reason" ${invalid(e, "reason")}>
          <datalist id="xPast">${past.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
          <div class="quick-chips" role="group" aria-label="${t("Common reasons")}">${QUICK_EXPENSES.map((q) => `<button type="button" class="btn small ghost" data-action="x-quick" data-value="${esc(q)}">${esc(t(q))}</button>`).join("")}</div>
          ${errText(e, "reason")}</div>
        <div class="row">
          <div class="field"><label for="xAmount">${t("Amount")}</label>
            <div class="affix"><span>ETB</span><input id="xAmount" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(d.amount)}" data-bind="expense.amount" ${invalid(e, "amount")}></div>${errText(e, "amount")}</div>
          <div class="field"><label for="xNote">${t("Note")} <span class="opt-label">${t("(optional)")}</span></label>
            <input id="xNote" class="input" autocomplete="off" placeholder="${t("e.g. receipt no.")}" value="${esc(d.note)}" data-bind="expense.note"></div>
        </div>
        <div class="field"><span class="label" id="xSrcLbl">${t("Paid from")}</span>
          <div class="pay-grid four" role="group" aria-labelledby="xSrcLbl">${SOURCE_IDS.map((s) =>
            `<button type="button" class="pay-opt" data-action="x-source" data-value="${s}" aria-pressed="${d.source === s}"><strong>${esc(tk(`src.${s}`))}</strong></button>`).join("")}</div></div>
        <div class="total-bar">
          <small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().name), id: esc(user().userId) })}</small>
          <button type="submit" class="btn primary">${icon("check")} ${t("Log expense")}</button>
        </div>
      </form>
      <section class="card" aria-labelledby="xlTitle">
        <div class="card-head"><div><h2 id="xlTitle">${t("Expenses in this period")}</h2>
          <p>${money(total, 0)} · ${t("{x} from petty cash", { x: money(petty, 0) })}</p></div></div>
        ${list.length ? `<ul class="entry-list">${list.slice(0, 30).map((x) => `<li class="entry row-hover">
          <strong>${esc(t(x.reason))}</strong><span class="num">${money(x.amount, 0)}</span>
          <div class="entry-meta"><span>${esc(tk(`src.${x.source}`))}${x.note ? ` · ${esc(x.note)}` : ""}</span>${stampOf(x.loggedBy, x.timestamp)}</div></li>`).join("")}</ul>`
          : empty(t("No expenses in this period"))}
      </section>
    </div>`;
}

export function onExpenseInput(key: string, value: string): void {
  if (key === "reason") { d.reason = value; clearErrors(["reason"]); }
  else if (key === "amount") { d.amount = value; clearErrors(["amount"]); }
  else if (key === "note") d.note = value;
}

export function submitExpense(): void {
  const amount = parseAmount(d.amount);
  const errors: FieldErrors = {};
  if (!d.reason.trim()) errors.reason = t("Write what the money was for.");
  if (!(amount > 0)) errors.amount = t("Enter an amount above 0.");
  if (showErrors(errors, ["reason", "amount"])) return;
  const rec = logExpense({ reason: d.reason.trim(), amount: round2(amount), source: d.source, note: d.note.trim() });
  d = { reason: "", amount: "", source: d.source, note: "" };
  state.errors = {};
  rerender("#xReason");
  toast(t("Logged {r} · {x} · {s} · by {name}", { r: t(rec.reason), x: money(rec.amount, 0), s: tk(`src.${rec.source}`), name: user().name }), () => { removeExpense(rec.id); rerender(); });
}

export const expenseActions: ActionMap = {
  "x-quick": (el) => {
    d.reason = el.dataset.value ?? "";
    const input = $<HTMLInputElement>("#xReason");
    if (input) input.value = t(d.reason);
    d.reason = input?.value ?? d.reason;
    clearErrors(["reason"]);
    $<HTMLElement>("#xAmount")?.focus();
  },
  "x-source": (el) => { const v = el.dataset.value ?? ""; if (isSource(v)) { d.source = v; setPressed(el); } },
};
