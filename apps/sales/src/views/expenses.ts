/* Other expenses: anything that is not stock — generator fuel,
   a plumber, a delivery bajaj. Free-text reason, a category tag, cost,
   and who logged it. */

import type { CustomExpenseRecord, ExpenseTag, FieldErrors } from "../types";
import { t, tk } from "../i18n";
import { localDay, money, parseAmount, relDay, round2, stamp, today } from "../format";
import { EXPENSE_METHODS, TAG_IDS, isExpenseMethod, isTag } from "../catalog";
import { newId } from "../seed";
import { canDelete, db, inPeriod, pastReasons, recordExpense, removeRecord, restoreRecord, state, stampUser, user } from "../store";
import { $, esc, icon } from "../ui/dom";
import { byline, clearErrors, errText, invalid, methodGrid, metricsBar, payName, setPressed, showErrors } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft {
  reason: string;
  tag: ExpenseTag | "";
  amount: string;
  method: CustomExpenseRecord["paymentMethod"];
  date: string;
  note: string;
}

const fresh = (): Draft => ({ reason: "", tag: "", amount: "", method: "CASH", date: today(), note: "" });
let d: Draft = fresh();

export function renderExpenses(): string {
  const e: FieldErrors = state.errors;
  const rows = db.expenses.filter((x) => inPeriod(x.timestamp)).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const total = rows.reduce((s, x) => s + x.amount, 0);
  const byTag = new Map<ExpenseTag, number>();
  for (const x of rows) byTag.set(x.tag, (byTag.get(x.tag) ?? 0) + x.amount);

  return `
    <div class="page-head"><div><h1>${t("Other expenses")}</h1><p>${t("Costs that are not stock: repairs, fuel, transport, fees. Write the reason in your own words.")}</p></div></div>
    ${metricsBar()}
    <div class="split">
      <form class="card form" id="expenseForm" novalidate aria-labelledby="xfTitle">
        <h2 id="xfTitle" class="sec-title">${t("New expense")}</h2>
        <div class="field"><label for="xReason">${t("Reason")}</label>
          <input id="xReason" class="input" list="reasonList" autocomplete="off" placeholder="${t("e.g. Generator fuel, plumber for kitchen sink")}" value="${esc(d.reason)}" data-bind="expense.reason" ${invalid(e, "reason")}>
          <datalist id="reasonList">${pastReasons().map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
          ${errText(e, "reason")}</div>
        <div class="field"><span class="label" id="tagLbl">${t("Category tag")}</span>
          <div class="reason-grid" role="group" aria-labelledby="tagLbl" ${invalid(e, "tag")} tabindex="-1">
            ${TAG_IDS.map((tg) => `<button type="button" class="reason" data-action="x-tag" data-value="${tg}" aria-pressed="${d.tag === tg}">${esc(tk(`tag.${tg}`))}</button>`).join("")}
          </div>${errText(e, "tag")}</div>
        <div class="row">
          <div class="field big-amt"><label for="xAmount">${t("Cost")}</label>
            <div class="affix"><span>ETB</span><input id="xAmount" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(d.amount)}" data-bind="expense.amount" ${invalid(e, "amount")}></div>${errText(e, "amount")}</div>
          <div class="field"><label for="xDate">${t("Date")}</label><input id="xDate" class="input" type="date" max="${today()}" value="${esc(d.date)}" data-bind="expense.date"></div>
        </div>
        <div class="field"><span class="label" id="xMethodLbl">${t("Paid with")}</span>${methodGrid("x-method", d.method, EXPENSE_METHODS, "xMethodLbl")}</div>
        <div class="field"><label for="xNote">${t("Note")} <span class="opt-label">${t("(optional)")}</span></label>
          <input id="xNote" class="input" type="text" placeholder="${t("e.g. who was paid")}" value="${esc(d.note)}" data-bind="expense.note"></div>
        <div class="total-bar">
          <div><span class="label">${t("Expense total")}</span><output id="xSum" aria-live="polite">${money(parseAmount(d.amount) || 0, 2)}</output>
            <small class="stamp">${icon("user")} ${t("Will be logged by {name}", { name: esc(user().name) })}</small></div>
          <div class="form-actions"><button type="submit" class="btn primary">${icon("check")} ${t("Save expense")}</button></div>
        </div>
      </form>
      <aside class="side">
        <section class="card">
          <div class="card-head"><div><h2>${t("Other expenses in this period")}</h2><p>${t("{n} entries · {x}", { n: rows.length, x: money(total, 0) })}</p></div></div>
          ${byTag.size ? `<div class="bar-list">${TAG_IDS.filter((tg) => byTag.get(tg)).map((tg) => `
            <div class="bar-row static"><span>${esc(tk(`tag.${tg}`))}</span><span class="num">${money(byTag.get(tg) ?? 0, 0)}</span>
              <span class="bar-track"><i style="width:${((byTag.get(tg) ?? 0) / total) * 100}%;background:var(--spend)"></i></span></div>`).join("")}</div>` : ""}
          ${rows.length ? `<ul class="entry-list">${rows.slice(0, 15).map((x) => `
            <li class="entry row-hover"><strong>${esc(x.reason)}</strong><span class="num">${money(x.amount)}</span>
              <div class="entry-meta"><span><span class="tag plain">${esc(tk(`tag.${x.tag}`))}</span> ${esc(payName(x.paymentMethod))} · ${relDay(localDay(x.timestamp))}</span>
                ${canDelete() ? `<button type="button" class="btn ghost small icon-btn" data-action="x-delete" data-value="${x.id}" aria-label="${t("Delete {x}", { x: x.reason })}">${icon("trash")}</button>` : ""}</div>
              ${x.note ? `<p class="note">${esc(x.note)}</p>` : ""}
              <div class="entry-meta">${byline(x.loggedBy, x.timestamp)}</div></li>`).join("")}</ul>`
            : `<div class="empty"><strong>${t("No other expenses in this period")}</strong></div>`}
        </section>
      </aside>
    </div>`;
}

export function onExpenseInput(key: string, value: string): void {
  if (key === "reason") { d.reason = value; clearErrors(["reason"]); }
  else if (key === "amount") { d.amount = value; clearErrors(["amount"]); const s = $("#xSum"); if (s) s.textContent = money(parseAmount(value) || 0, 2); }
  else if (key === "date") d.date = value;
  else if (key === "note") d.note = value;
}

function submit(): void {
  const amount = parseAmount(d.amount);
  const errors: FieldErrors = {};
  if (!d.reason.trim()) errors.reason = t("Write the reason for this expense.");
  if (!d.tag) errors.tag = t("Choose a category tag.");
  if (!(amount > 0)) errors.amount = t("Enter a cost above 0.");
  if (showErrors(errors, ["reason", "tag", "amount"]) || !d.tag) return;
  const { loggedBy, userId } = stampUser();
  const rec: CustomExpenseRecord = {
    id: newId("exp"), reason: d.reason.trim(), tag: d.tag, amount: round2(amount), paymentMethod: d.method, note: d.note.trim(),
    loggedBy, userId, timestamp: d.date === today() ? new Date().toISOString() : stamp(d.date, 12),
  };
  recordExpense(rec);
  d = fresh();
  state.errors = {};
  rerender("#xReason");
  toast(t("Saved {item} · {x} · by {name}", { item: rec.reason, x: money(rec.amount, 2), name: loggedBy }), () => {
    removeRecord("EXPENSE", rec.id);
    rerender();
  });
}

export const submitExpense = submit;

export const expenseActions: ActionMap = {
  "x-tag": (el) => { const v = el.dataset.value ?? ""; if (isTag(v)) { d.tag = v; setPressed(el); clearErrors(["tag"]); } },
  "x-method": (el) => { const v = el.dataset.value ?? ""; if (isExpenseMethod(v)) { d.method = v; setPressed(el); } },
  "x-delete": (el) => {
    const removed = removeRecord("EXPENSE", el.dataset.value ?? "");
    if (removed) { rerender(); toast(t("Deleted by {name}", { name: user().name }), () => { restoreRecord(removed); rerender(); }); }
  },
};
