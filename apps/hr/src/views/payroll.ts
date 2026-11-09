/* Payroll: automated salary calculation for a month.
   gross = base pay (monthly salary, or hourly rate × regular hours)
         + overtime hours × hourly rate × multiplier (1.5 / 1.75 / 2)
   net   = gross − PAYE income tax − 7% employee pension
   Employer adds 11% pension. Each row expands to show the working.
   A month is approved (and stamped) by the manager. */

import type { Payslip } from "../types";
import { monthName, t } from "../i18n";
import { addDays, money, num, parseDay, today } from "../format";
import { PAYE_BRACKETS, PENSION_EMPLOYEE, PENSION_EMPLOYER } from "../catalog";
import { workedHours } from "../seed";
import { approvePayroll, db, employee, monthRange, payrollRun, payslip, reopenPayroll, state, user } from "../store";
import { esc, icon } from "../ui/dom";
import { empty, fmtH, payLabel, pill, seg, staffCell, stampOf } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

const monthLabel = (m: string): string => { const d = parseDay(`${m}-01`); return `${monthName(d.getMonth())} ${d.getFullYear()}`; };
export const prevMonth = (): string => addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7);

function bracketText(taxable: number): string {
  const b = PAYE_BRACKETS.find((x) => taxable <= x.upTo) ?? PAYE_BRACKETS[PAYE_BRACKETS.length - 1];
  return b.rate ? `${Math.round(b.rate * 100)}% − ${money(b.deduction, 0)}` : t("tax-free band");
}

function slips(): { e: NonNullable<ReturnType<typeof employee>>; p: Payslip }[] {
  const [from, to] = monthRange(state.payMonth);
  return db.employees
    .filter((e) => e.branchId === state.branch && e.hireDate <= to)
    .map((e) => ({ e, p: payslip(e, state.payMonth) }))
    .filter(({ e, p }) => e.status === "ACTIVE" || p.regularHours > 0 || db.attendance.some((a) => a.employeeId === e.id && a.shiftDate >= from && a.shiftDate <= to && a.status === "COMPLETED"))
    .sort((a, b) => b.p.netPay - a.p.netPay);
}

function breakdown(e: NonNullable<ReturnType<typeof employee>>, p: Payslip): string {
  const [from, to] = monthRange(state.payMonth);
  const ot = db.attendance.filter((a) => a.employeeId === e.id && a.shiftDate >= from && a.shiftDate <= to && a.overtimeHours > 0);
  const scaleNote = p.prorated ? ` <small class="meta">${t("(month to date)")}</small>` : "";
  return `<div class="slip">
    <dl>
      <div><dt>${t("Base pay")}</dt><dd>${e.payType === "MONTHLY"
        ? `${money(e.monthlySalary ?? 0, 0)} ${t("monthly salary")}${p.prorated ? ` × ${t("days so far")}` : ""}`
        : `${fmtH(p.regularHours)} × ${money(e.hourlyRate, 2)}`} = <strong>${money(p.basePay, 2)}</strong>${scaleNote}</dd></div>
      <div><dt>${t("Overtime")}</dt><dd>${ot.length ? ot.map((a) => `${esc(a.shiftDate.slice(5))}: ${fmtH(a.overtimeHours)} × ${money(e.hourlyRate, 2)} × ${a.overtimeMultiplier}`).join("<br>") : "—"}
        ${ot.length ? `<br>= <strong>${money(p.overtimePay, 2)}</strong>` : ""}</dd></div>
      <div><dt>${t("Gross taxable")}</dt><dd><strong>${money(p.grossTaxable, 2)}</strong></dd></div>
      <div><dt>${t("Income tax (PAYE)")}</dt><dd>${bracketText(p.grossTaxable * (p.prorated ? parseDay(to).getDate() / parseDay(today()).getDate() : 1))} = <strong class="bad-text">−${money(p.incomeTax, 2)}</strong>
        ${p.prorated ? `<small class="meta">${t("bracket from the pay scaled to a full month")}</small>` : ""}</dd></div>
      <div><dt>${t("Pension (employee 7%)")}</dt><dd>${money(p.basePay, 2)} × 7% = <strong class="bad-text">−${money(p.pensionEmployee, 2)}</strong></dd></div>
      <div class="net"><dt>${t("Net pay")}</dt><dd><strong>${money(p.netPay, 2)}</strong></dd></div>
      <div><dt>${t("Employer pension (11%)")}</dt><dd>${money(p.pensionEmployer, 2)} <small class="meta">${t("paid by the restaurant, not deducted")}</small></dd></div>
    </dl>
    <p class="meta">${t("{n} shifts worked", { n: db.attendance.filter((a) => a.employeeId === e.id && a.shiftDate >= from && a.shiftDate <= to && a.status === "COMPLETED").length })} ·
      ${t("{h} on the clock", { h: fmtH(db.attendance.filter((a) => a.employeeId === e.id && a.shiftDate >= from && a.shiftDate <= to && a.status === "COMPLETED").reduce((s, a) => s + workedHours(a), 0)) })}</p>
  </div>`;
}

export function renderPayroll(): string {
  const rows = slips();
  const run = payrollRun(state.payMonth);
  const sum = (k: keyof Payslip): number => rows.reduce((s, r) => s + (r.p[k] as number), 0);
  const cur = today().slice(0, 7);
  const months = [prevMonth(), cur];
  const approved = run.status === "APPROVED";
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Payroll")}</h1>
      <p>${t("Base pay + overtime − income tax − 7% pension. Rules: PAYE after Proclamation 1395/2025; overtime per Labour Proclamation 1156/2019.")}</p></div>
      <div class="head-controls">${seg("pay-month", state.payMonth, months.map((m) => [m, m === cur ? `${monthLabel(m)} · ${t("to date")}` : monthLabel(m)] as const), t("Month"), "small")}</div></div>
    <div class="pay-status card ${approved ? "ok" : ""}">
      <div>${approved ? pill("good", t("Approved")) : pill("warn", t("Draft"))}
        <span>${approved && run.approvedBy && run.approvedAt ? stampOf(run.approvedBy, run.approvedAt, t("Approved by")) : state.payMonth === cur ? t("Month in progress — figures are month to date.") : t("Check the figures, then approve.")}</span></div>
      ${approved ? `<button type="button" class="btn small ghost" data-action="pay-reopen">${t("Reopen")}</button>`
        : `<button type="button" class="btn primary" data-action="pay-approve" ${state.payMonth === cur ? "disabled title=\"" + t("You can approve after the month ends") + "\"" : ""}>${icon("check")} ${t("Approve payroll")}</button>`}
    </div>
    <div class="stat-row six">
      <div class="stat"><span>${t("Gross pay")}</span><strong class="num">${money(sum("grossTaxable"), 0)}</strong></div>
      <div class="stat"><span>${t("Overtime pay")}</span><strong class="num">${money(sum("overtimePay"), 0)}</strong><small>${fmtH(sum("overtimeHours"))}</small></div>
      <div class="stat"><span>${t("Income tax")}</span><strong class="num">${money(sum("incomeTax"), 0)}</strong></div>
      <div class="stat"><span>${t("Pension 7% + 11%")}</span><strong class="num">${money(sum("pensionEmployee") + sum("pensionEmployer"), 0)}</strong></div>
      <div class="stat"><span>${t("Net pay")}</span><strong class="num good-text">${money(sum("netPay"), 0)}</strong>
        <small>${t("Labour cost {x}", { x: money(sum("grossTaxable") + sum("pensionEmployer"), 0) })}</small></div>
    </div>
    <section class="card">
      ${rows.length ? `<div class="table-wrap"><table class="data payroll-table">
        <caption class="sr">${t("Payroll for {m}", { m: monthLabel(state.payMonth) })}</caption>
        <thead><tr><th scope="col">${t("Staff")}</th><th scope="col" class="num">${t("Rate")}</th><th scope="col" class="num">${t("Regular")}</th><th scope="col" class="num">${t("OT")}</th>
          <th scope="col" class="num">${t("Base pay")}</th><th scope="col" class="num">${t("OT pay")}</th><th scope="col" class="num">${t("Gross")}</th>
          <th scope="col" class="num">${t("Tax")}</th><th scope="col" class="num">${t("Pension 7%")}</th><th scope="col" class="num">${t("Net pay")}</th></tr></thead>
        <tbody>${rows.map(({ e, p }) => `
          <tr class="payrow ${state.payOpen === e.id ? "open" : ""}">
            <th scope="row"><button type="button" class="link-btn" data-action="pay-open" data-value="${e.id}" aria-expanded="${state.payOpen === e.id}">
              ${icon("chevr")}${staffCell(e.id)}</button></th>
            <td class="num">${payLabel(e)}</td><td class="num">${fmtH(p.regularHours)}</td><td class="num ${p.overtimeHours ? "warn-text" : ""}">${p.overtimeHours ? fmtH(p.overtimeHours) : "—"}</td>
            <td class="num">${money(p.basePay, 0)}</td><td class="num">${p.overtimePay ? money(p.overtimePay, 0) : "—"}</td><td class="num">${money(p.grossTaxable, 0)}</td>
            <td class="num">${money(p.incomeTax, 0)}</td><td class="num">${money(p.pensionEmployee, 0)}</td>
            <td class="num strong">${money(p.netPay, 0)}</td>
          </tr>
          ${state.payOpen === e.id ? `<tr class="slip-row"><td colspan="10">${breakdown(e, p)}</td></tr>` : ""}`).join("")}</tbody>
        <tfoot><tr><th scope="row">${t("Total")} · ${num(rows.length)}</th><td></td><td class="num">${fmtH(sum("regularHours"))}</td><td class="num">${fmtH(sum("overtimeHours"))}</td>
          <td class="num">${money(sum("basePay"), 0)}</td><td class="num">${money(sum("overtimePay"), 0)}</td><td class="num">${money(sum("grossTaxable"), 0)}</td>
          <td class="num">${money(sum("incomeTax"), 0)}</td><td class="num">${money(sum("pensionEmployee"), 0)}</td><td class="num strong">${money(sum("netPay"), 0)}</td></tr></tfoot>
      </table></div>` : empty(t("No staff to pay for this month"))}
    </section>
    <section class="card rules">
      <div class="card-head"><div><h2>${t("How it is calculated")}</h2></div></div>
      <div class="rules-grid">
        <div><h3>${t("Income tax (monthly PAYE)")}</h3><table class="data compact"><tbody>${PAYE_BRACKETS.map((b, i) => {
          const lo = i === 0 ? 0 : PAYE_BRACKETS[i - 1].upTo + 1;
          return `<tr><td>${money(lo, 0)} – ${b.upTo === Infinity ? "…" : money(b.upTo, 0)}</td><td class="num">${Math.round(b.rate * 100)}%</td><td class="num">${b.deduction ? `−${money(b.deduction, 0)}` : "—"}</td></tr>`;
        }).join("")}</tbody></table></div>
        <div><h3>${t("Overtime")}</h3><ul class="plain">
          <li>${t("Over 8 hours in a day")}: ×1.5</li><li>${t("Overtime ending after 22:00")}: ×1.75</li><li>${t("Weekly rest day (Sunday)")}: ×2</li>
          <li>${t("Salaried staff: hourly rate = salary ÷ 208 hours")}</li></ul></div>
        <div><h3>${t("Pension")}</h3><ul class="plain">
          <li>${t("Employee pension {p}% of base pay", { p: Math.round(PENSION_EMPLOYEE * 100) })}</li><li>${t("Employer pension {p}% of base pay", { p: Math.round(PENSION_EMPLOYER * 100) })}</li></ul></div>
      </div>
    </section>`;
}

export const payrollActions: ActionMap = {
  "pay-month": (el) => {
    const v = el.dataset.value ?? "";
    if (!/^\d{4}-\d{2}$/.test(v)) return;
    state.payMonth = v;
    state.payOpen = null;
    rerender(`[data-action="pay-month"][data-value="${v}"]`);
  },
  "pay-open": (el) => {
    const id = el.dataset.value ?? "";
    state.payOpen = state.payOpen === id ? null : id;
    rerender(`[data-action="pay-open"][data-value="${id}"]`);
  },
  "pay-approve": () => {
    const m = state.payMonth;
    approvePayroll(m);
    rerender('[data-action="pay-reopen"]');
    toast(t("Payroll for {m} approved by {name}", { m: monthLabel(m), name: user().fullName }), () => { reopenPayroll(m); rerender(); });
  },
  "pay-reopen": () => {
    const m = state.payMonth;
    const run = { ...payrollRun(m) };
    reopenPayroll(m);
    rerender('[data-action="pay-approve"]');
    toast(t("Payroll for {m} reopened", { m: monthLabel(m) }), () => { Object.assign(payrollRun(m), run); rerender(); });
  },
};
