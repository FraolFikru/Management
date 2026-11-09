/* Today: who is on shift, on break, late or absent; the live clock board;
   labour cost so far this month; latest incidents. */

import { t, tk } from "../i18n";
import { money, today } from "../format";
import { workedHours } from "../seed";
import { attendanceOn, branchStaff, db, employee, onBreak, payslip, state, user } from "../store";
import { esc, icon } from "../ui/dom";
import { dayLabel, empty, fmtH, metricCard } from "../ui/shared";
import { attendanceRows, boardHead } from "./attendance";
import { logItem } from "./performance";

export function renderToday(): string {
  const day = today();
  const list = attendanceOn(day);
  const on = list.filter((a) => a.status === "CLOCKED_IN" && !onBreak(a)).length;
  const brk = list.filter(onBreak).length;
  const notIn = list.filter((a) => a.status === "SCHEDULED" && Date.now() > new Date(a.scheduledStart).getTime() + 5 * 60_000);
  const late = list.filter((a) => a.lateMinutes > 0).length + notIn.length;
  const absent = list.filter((a) => a.status === "ABSENT").length;
  const hoursToday = list.reduce((s, a) => s + workedHours(a), 0);
  const month = day.slice(0, 7);
  const net = branchStaff(true).reduce((s, e) => s + payslip(e, month).grossTaxable, 0);
  const logs = db.logs.filter((l) => employee(l.employeeId)?.branchId === state.branch).slice(0, 4);
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Good day, {name}", { name: esc(user().fullName.split(" ")[0]) })}</h1>
      <p>${esc(tk(`branch.${state.branch}`))} · ${esc(dayLabel(day))}</p></div></div>
    <section class="metrics"><h2 class="sr">${t("Today at a glance")}</h2><div class="metric-grid">
      ${metricCard({ icon: "users", title: t("On shift now"), value: String(on), note: brk ? t("{n} on break", { n: brk }) : t("Nobody on break"), href: "attendance", tone: "good" })}
      ${metricCard({ icon: "clock", title: t("Late / not in yet"), value: String(late), note: notIn.length ? t("{n} not clocked in", { n: notIn.length }) : t("Everyone due is in"), href: "attendance", tone: late ? "warn" : "" })}
      ${metricCard({ icon: "alert", title: t("Absent today"), value: String(absent), note: t("{n} scheduled today", { n: list.length }), href: "attendance", tone: absent ? "bad" : "" })}
      ${metricCard({ icon: "wallet", title: t("Gross pay this month"), value: money(net, 0), note: t("{h} worked today", { h: fmtH(hoursToday) }), href: "payroll" })}
    </div></section>
    ${notIn.length ? `<a class="alert-banner" href="#attendance">${icon("alert")}<span><strong>${t("{n} people are late and have not clocked in", { n: notIn.length })}</strong>
      <small>${notIn.map((a) => esc(a.employeeName)).join(", ")}</small></span>${icon("arrow")}</a>` : ""}
    <section class="card" aria-labelledby="liveTitle">
      <div class="card-head"><div><h2 id="liveTitle">${t("Live clock board")}</h2><p>${t("Clock people in and out, start and end breaks.")}</p></div>
        <a class="btn small" href="#attendance">${t("Attendance")} ${icon("arrow")}</a></div>
      ${list.length ? `<div class="table-wrap"><table class="data att-table">${boardHead(true)}<tbody>${attendanceRows(list, true)}</tbody></table></div>` : empty(t("Nobody scheduled today"))}
    </section>
          <section class="card"><div class="card-head"><div><h2>${t("Latest incidents & reviews")}</h2></div><a class="btn small" href="#performance">${t("All logs")} ${icon("arrow")}</a></div>
        ${logs.length ? `<ul class="log-list compact">${logs.map((l) => logItem(l)).join("")}</ul>` : empty(t("No entries yet"))}</section>
    </div>`;
}
