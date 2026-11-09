/* Clock-in / clock-out tracker. One row per scheduled person for the
   chosen day: planned shift, status, clock-in (and how late), breaks,
   hours worked (live while on shift) and overtime. Today's rows have the
   buttons: Clock in · Start/End break · Clock out · Mark absent.
   Every press is stamped and can be undone. */

import type { AttendanceRecord } from "../types";
import { t, tk } from "../i18n";
import { addDays, fmtTime, today } from "../format";
import { NORMAL_DAY_HOURS, SHIFT_COLOR } from "../catalog";
import { workedHours } from "../seed";
import {
  attendanceOn, breakMinutes, clockIn, clockOut, db, employee, onBreak, restoreAttendance, snapshot, state, toggleBreak, user,
} from "../store";
import { $, $$, esc, icon } from "../ui/dom";
import { bar, dayLabel, empty, fmtH, pill, staffCell } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "../ui/modal-bus";

export function statusOf(a: AttendanceRecord): { kind: string; label: string } {
  if (a.status === "ABSENT") return { kind: "bad", label: t("Absent") };
  if (a.status === "COMPLETED") return { kind: "done", label: t("Completed") };
  if (a.status === "CLOCKED_IN") return onBreak(a) ? { kind: "break", label: t("On break") } : { kind: "good", label: t("On shift") };
  const late = Date.now() > new Date(a.scheduledStart).getTime() + 5 * 60_000;
  return late ? { kind: "warn", label: t("Not in yet") } : { kind: "muted", label: t("Scheduled") };
}

const shiftChip = (a: AttendanceRecord): string =>
  `<span class="shift-chip" style="--shift:${SHIFT_COLOR[a.shift]}">${esc(tk(`shift.${a.shift}`))}</span>
   <small class="mono">${fmtTime(a.scheduledStart)}–${fmtTime(a.scheduledEnd)}</small>`;

function actions(a: AttendanceRecord): string {
  if (a.shiftDate !== today()) return "";
  if (a.status === "SCHEDULED") {
    return `<button type="button" class="btn small primary" data-action="clock-in" data-value="${a.id}">${icon("play")} ${t("Clock in")}</button>
      <button type="button" class="btn small ghost" data-action="mark-absent" data-value="${a.id}">${t("Mark absent")}</button>`;
  }
  if (a.status === "CLOCKED_IN") {
    return `<button type="button" class="btn small" data-action="toggle-break" data-value="${a.id}">${onBreak(a) ? `${icon("play")} ${t("End break")}` : `${icon("pause")} ${t("Start break")}`}</button>
      <button type="button" class="btn small primary" data-action="clock-out" data-value="${a.id}">${icon("check")} ${t("Clock out")}</button>`;
  }
  return "";
}

/** The board as table rows (also used on the Today page). */
export function attendanceRows(list: AttendanceRecord[], withActions = true): string {
  return list.map((a) => {
    const st = statusOf(a);
    const worked = workedHours(a);
    const ot = a.status === "COMPLETED" ? a.overtimeHours : Math.max(0, worked - NORMAL_DAY_HOURS);
    return `<tr id="att-${a.id}" class="${a.status === "CLOCKED_IN" ? "live-row" : a.status === "SCHEDULED" || a.status === "ABSENT" ? "idle-row" : ""}">
      <th scope="row">${staffCell(a.employeeId)}</th>
      <td data-label="${t("Shift")}">${shiftChip(a)}</td>
      <td class="st-cell">${pill(st.kind, st.label)}</td>
      <td class="num" data-label="${t("Clock in")}">${a.clockIn ? `${fmtTime(a.clockIn)}${a.lateMinutes ? `<small class="late">+${a.lateMinutes} ${t("min late")}</small>` : ""}` : "—"}</td>
      <td class="num" data-label="${t("Clock out")}">${a.clockOut ? fmtTime(a.clockOut) : "—"}</td>
      <td class="num" data-label="${t("Breaks")}" data-live-break="${a.id}">${a.breaks.length ? `${Math.round(breakMinutes(a))} ${t("min")}` : "—"}</td>
      <td class="num strong" data-label="${t("Worked")}" data-live-worked="${a.id}">${a.clockIn ? fmtH(worked) : "—"}</td>
      <td class="num ${ot > 0 ? "warn-text" : ""}" data-label="${t("Overtime")}" data-live-ot="${a.id}">${ot > 0 ? `${fmtH(ot)}<small>×${a.overtimeMultiplier}</small>` : "—"}</td>
      ${withActions ? `<td class="row-actions-cell"><div class="row-actions">${actions(a)}</div></td>` : ""}
    </tr>`;
  }).join("");
}

export const boardHead = (withActions = true): string => `<thead><tr><th scope="col">${t("Staff")}</th><th scope="col">${t("Shift")}</th><th scope="col">${t("Status")}</th>
  <th scope="col" class="num">${t("Clock in")}</th><th scope="col" class="num">${t("Clock out")}</th><th scope="col" class="num">${t("Breaks")}</th>
  <th scope="col" class="num">${t("Worked")}</th><th scope="col" class="num">${t("Overtime")}</th>${withActions ? `<th scope="col"><span class="sr">${t("Actions")}</span></th>` : ""}</tr></thead>`;

export function renderAttendance(): string {
  const day = state.attDay;
  const list = attendanceOn(day);
  const isToday = day === today();
  const counts = {
    scheduled: list.length,
    on: list.filter((a) => a.status === "CLOCKED_IN" && !onBreak(a)).length,
    brk: list.filter(onBreak).length,
    late: list.filter((a) => a.lateMinutes > 0).length,
    absent: list.filter((a) => a.status === "ABSENT").length,
    ot: list.reduce((s, a) => s + a.overtimeHours, 0),
  };
  // week overtime per person
  const weekFrom = addDays(day, -6);
  const otBy = new Map<string, number>();
  for (const a of db.attendance) {
    if (a.shiftDate < weekFrom || a.shiftDate > day || !a.overtimeHours || employee(a.employeeId)?.branchId !== state.branch) continue;
    otBy.set(a.employeeId, (otBy.get(a.employeeId) ?? 0) + a.overtimeHours);
  }
  const otList = [...otBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const otMax = Math.max(0, ...otList.map((x) => x[1]));
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Attendance")}</h1><p>${t("Clock-in / clock-out, breaks and overtime. Overtime starts after 8 hours worked in a day.")}</p></div>
      <div class="head-controls day-nav">
        <button type="button" class="btn icon-btn" data-action="att-day" data-value="-1" aria-label="${t("Previous day")}">${icon("chevl")}</button>
        <label class="date-pick"><span class="sr">${t("Day")}</span><input type="date" class="input" max="${today()}" value="${day}" data-bind="att.day"></label>
        <button type="button" class="btn icon-btn" data-action="att-day" data-value="1" aria-label="${t("Next day")}" ${isToday ? "disabled" : ""}>${icon("chevr")}</button>
        ${isToday ? "" : `<button type="button" class="btn small" data-action="att-today">${t("Today")}</button>`}
      </div></div>
    <div class="stat-row six">
      <div class="stat"><span>${t("Scheduled")}</span><strong class="num">${counts.scheduled}</strong></div>
      <div class="stat"><span>${t("On shift")}</span><strong class="num good-text">${counts.on}</strong></div>
      <div class="stat"><span>${t("On break")}</span><strong class="num">${counts.brk}</strong></div>
      <div class="stat"><span>${t("Late")}</span><strong class="num ${counts.late ? "warn-text" : ""}">${counts.late}</strong></div>
      <div class="stat"><span>${t("Absent")}</span><strong class="num ${counts.absent ? "bad-text" : ""}">${counts.absent}</strong></div>
      <div class="stat"><span>${t("Overtime")}</span><strong class="num">${fmtH(counts.ot)}</strong></div>
    </div>
    <section class="card" aria-labelledby="boardTitle">
      <div class="card-head"><div><h2 id="boardTitle">${esc(dayLabel(day))}</h2>
        <p>${isToday ? t("Live: hours update every 30 seconds.") : t("Past day: read-only.")}</p></div></div>
      ${list.length ? `<div class="table-wrap"><table class="data att-table">${boardHead(isToday)}<tbody>${attendanceRows(list, isToday)}</tbody></table></div>`
        : empty(t("Nobody scheduled on this day"))}
    </section>
    <section class="card" aria-labelledby="otTitle">
      <div class="card-head"><div><h2 id="otTitle">${t("Overtime, last 7 days")}</h2><p>${t("Paid at 1.5× (day), 1.75× (after 22:00), 2× (Sunday rest day)")}</p></div></div>
      ${otList.length ? `<div class="bar-list">${otList.map(([id, h]) => bar(`${esc(employee(id)?.fullName ?? id)}`, h, otMax, "#fb9a4b", fmtH(h))).join("")}</div>` : empty(t("No overtime in the last 7 days"))}
    </section>`;
}

/** Update live hour cells without re-rendering (keeps focus). */
export function refreshLive(): void {
  for (const el of $$<HTMLElement>("[data-live-worked]")) {
    const a = db.attendance.find((x) => x.id === el.dataset.liveWorked);
    if (!a || a.status !== "CLOCKED_IN") continue;
    const w = workedHours(a);
    el.textContent = fmtH(w);
    const ot = $(`[data-live-ot="${a.id}"]`);
    if (ot) ot.innerHTML = w > NORMAL_DAY_HOURS ? `${fmtH(w - NORMAL_DAY_HOURS)}<small>×${a.overtimeMultiplier}</small>` : "—";
    const br = $(`[data-live-break="${a.id}"]`);
    if (br && a.breaks.length) br.textContent = `${Math.round(breakMinutes(a))} ${t("min")}`;
  }
}

const withUndo = (id: string, msg: string, before: AttendanceRecord): void => {
  rerender(`#att-${id} .row-actions button`);
  toast(msg, () => { restoreAttendance(before); rerender(); });
};

export const attendanceActions: ActionMap = {
  "att-day": (el) => {
    const next = addDays(state.attDay, Number(el.dataset.value));
    if (next > today()) return;
    state.attDay = next;
    rerender(`[data-action="att-day"][data-value="${el.dataset.value}"]`);
  },
  "att-today": () => { state.attDay = today(); rerender(); },
  "clock-in": (el) => {
    const a0 = db.attendance.find((x) => x.id === el.dataset.value);
    if (!a0) return;
    const before = snapshot(a0);
    const a = clockIn(a0.id);
    if (!a) return;
    withUndo(a.id, t("{name} clocked in at {time}", { name: a.employeeName, time: fmtTime(a.clockIn) }) +
      (a.lateMinutes ? ` · ${t("{n} min late", { n: a.lateMinutes })}` : "") + ` · ${t("by {name}", { name: user().fullName })}`, before);
  },
  "toggle-break": (el) => {
    const a0 = db.attendance.find((x) => x.id === el.dataset.value);
    if (!a0) return;
    const before = snapshot(a0);
    const res = toggleBreak(a0.id);
    if (!res) return;
    withUndo(a0.id, res === "start" ? t("{name} started a break", { name: a0.employeeName }) : t("{name} is back from break", { name: a0.employeeName }), before);
  },
  "clock-out": (el) => {
    const a0 = db.attendance.find((x) => x.id === el.dataset.value);
    if (!a0) return;
    const before = snapshot(a0);
    const a = clockOut(a0.id);
    if (!a) return;
    withUndo(a.id, t("{name} clocked out · worked {h}", { name: a.employeeName, h: fmtH(workedHours(a)) }) +
      (a.overtimeHours ? ` · ${t("overtime {h}", { h: fmtH(a.overtimeHours) })}` : ""), before);
  },
  "mark-absent": (el) => openModal({ kind: "absent", id: el.dataset.value ?? "" }, el),
};
