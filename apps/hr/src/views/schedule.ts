/* Shift planner: weekly grid, staff × days. Drag a shift from the
   palette onto a cell, drag a planned shift to another cell or person
   to move it, or drop it on "Remove". Click (or Enter on) any cell to
   pick a shift from a menu — the same planner works by touch and
   keyboard. Past days are locked. Shows weekly hours per person
   (warning above 48 h) and coverage per shift against the target. */

import type { ShiftCode } from "../types";
import { t, tk, weekdayName } from "../i18n";
import { addDays, fmtDay, parseDay, today } from "../format";
import { COVERAGE_TARGET, NORMAL_WEEK_HOURS, SHIFTS, SHIFT_COLOR, SHIFT_IDS, isShift } from "../catalog";
import { weekStart } from "../seed";
import { branchStaff, copyPreviousWeek, db, entryFor, moveShift, setShift, state, weekDays, weekHours } from "../store";
import { $, esc, icon } from "../ui/dom";
import { avatar, empty, roleName, seg } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

type Group = "ALL" | "SALES" | "KITCHEN" | "OTHER";
let group: Group = "ALL";
let menuFor: string | null = null; // "empId|date"

const chip = (code: ShiftCode, draggable: string): string =>
  `<span class="shift-chip big" style="--shift:${SHIFT_COLOR[code]}" ${draggable}>
    <strong>${esc(tk(`shift.${code}`))}</strong><small>${SHIFTS[code].start}–${SHIFTS[code].end}</small></span>`;

function staffList() {
  return branchStaff().filter((e) =>
    group === "ALL" || (group === "SALES" && e.role === "SALES_STAFF") || (group === "KITCHEN" && e.role === "KITCHEN_STAFF") ||
    (group === "OTHER" && e.role !== "SALES_STAFF" && e.role !== "KITCHEN_STAFF"));
}

function cell(empId: string, day: string): string {
  const e = entryFor(empId, day);
  const locked = day < today();
  const key = `${empId}|${day}`;
  const name = db.employees.find((x) => x.id === empId)?.fullName ?? empId;
  const label = `${name}, ${weekdayName(parseDay(day).getDay())} ${fmtDay(day)}: ${e ? tk(`shift.${e.shift}`) : t("Off")}`;
  return `<td class="plan-cell ${locked ? "locked" : ""} ${day === today() ? "is-today" : ""}" data-cell="${key}" ${locked ? 'data-locked="1"' : ""}>
    <button type="button" class="cell-btn" data-action="cell-menu" data-value="${key}" aria-label="${esc(label)}" aria-haspopup="menu" aria-expanded="${menuFor === key}" ${locked ? "disabled" : ""}>
      ${e ? chip(e.shift, locked ? "" : `draggable="true" data-drag-from="${key}"`) : `<span class="off">${locked ? "—" : `${icon("plus")}<span class="sr">${t("Add shift")}</span>`}</span>`}
    </button>
    ${menuFor === key ? `<div class="cell-menu" role="menu" aria-label="${t("Choose shift")}">
      ${SHIFT_IDS.map((s) => `<button type="button" role="menuitem" data-action="cell-set" data-value="${key}|${s}">${chip(s, "")}</button>`).join("")}
      ${e ? `<button type="button" role="menuitem" class="off-item" data-action="cell-set" data-value="${key}|OFF">${icon("x")} ${t("Day off")}</button>` : ""}
    </div>` : ""}
  </td>`;
}

export function renderSchedule(): string {
  const days = weekDays();
  const staff = staffList();
  const thisWeek = weekStart(today());
  const totalHours = staff.reduce((s, e) => s + weekHours(e.id), 0);
  const over = staff.filter((e) => weekHours(e.id) > NORMAL_WEEK_HOURS).length;
  const coverage = (day: string, s: ShiftCode): number => branchStaff().filter((e) => entryFor(e.id, day)?.shift === s).length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Shift planner")}</h1>
      <p>${t("Drag a shift onto a cell, drag a planned shift to move it, or click a cell to choose.")}</p></div>
      <div class="head-controls day-nav">
        <button type="button" class="btn icon-btn" data-action="week" data-value="-7" aria-label="${t("Previous week")}">${icon("chevl")}</button>
        <span class="week-label">${esc(fmtDay(days[0]))} – ${esc(fmtDay(days[6]))}</span>
        <button type="button" class="btn icon-btn" data-action="week" data-value="7" aria-label="${t("Next week")}">${icon("chevr")}</button>
        ${state.week !== thisWeek ? `<button type="button" class="btn small" data-action="week-now">${t("This week")}</button>` : ""}
        <button type="button" class="btn small" data-action="copy-week">${icon("copy")} ${t("Copy last week")}</button>
      </div></div>
    <div class="planner-bar card">
      <div class="palette" aria-label="${t("Shifts to drag")}">
        <span class="label">${t("Drag")}</span>
        ${SHIFT_IDS.map((s) => chip(s, `draggable="true" data-drag-shift="${s}"`)).join("")}
        <span class="trash-drop" data-drop-remove="1">${icon("trash")} ${t("Drop here to remove")}</span>
      </div>
      <div class="planner-meta">
        ${seg("plan-group", group, [["ALL", t("All")], ["SALES", t("Sales")], ["KITCHEN", t("Kitchen")], ["OTHER", t("Management & stock")]], t("Show"), "small")}
        <span class="meta">${t("{h} planned hours", { h: totalHours })}${over ? ` · <strong class="warn-text">${t("{n} over 48 h", { n: over })}</strong>` : ""}</span>
      </div>
    </div>
    <section class="card plan-card">
      ${staff.length ? `<div class="table-wrap"><table class="plan">
        <caption class="sr">${t("Weekly shift plan")}</caption>
        <thead><tr><th scope="col" class="who-col">${t("Staff")}</th>${days.map((d) => `<th scope="col" class="${d === today() ? "is-today" : ""}">
          <span>${esc(weekdayName(parseDay(d).getDay()))}</span><small>${esc(fmtDay(d))}</small></th>`).join("")}<th scope="col" class="num">${t("Hours")}</th></tr></thead>
        <tbody>${staff.map((e) => {
          const h = weekHours(e.id);
          return `<tr><th scope="row" class="who-col"><span class="staff-cell">${avatar(e.id, "sm")}<span><strong>${esc(e.fullName)}</strong><small>${esc(roleName(e.role))}</small></span></span></th>
            ${days.map((d) => cell(e.id, d)).join("")}
            <td class="num ${h > NORMAL_WEEK_HOURS ? "warn-text" : ""}">${h}${t("h")}</td></tr>`;
        }).join("")}</tbody>
        <tfoot>${SHIFT_IDS.map((s) => `<tr class="cov-row"><th scope="row" class="who-col"><span class="cov-label">${esc(tk(`shift.${s}`))} · ${t("target {n}", { n: COVERAGE_TARGET[s] })}</span></th>
          ${days.map((d) => { const n = coverage(d, s); const ok = n >= COVERAGE_TARGET[s]; return `<td class="cov ${ok ? "ok" : "short"}">${n}/${COVERAGE_TARGET[s]}</td>`; }).join("")}<td></td></tr>`).join("")}</tfoot>
      </table></div>` : empty(t("No active staff in this group"))}
    </section>`;
}

/* ---------- drag & drop (wired from main.ts) ---------- */

let dragPayload: { shift?: ShiftCode; from?: string } | null = null;

export function onDragStart(e: DragEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drag-shift], [data-drag-from]");
  if (!el) return;
  dragPayload = el.dataset.dragShift && isShift(el.dataset.dragShift) ? { shift: el.dataset.dragShift } : { from: el.dataset.dragFrom };
  e.dataTransfer?.setData("text/plain", el.dataset.dragShift ?? el.dataset.dragFrom ?? "");
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  document.body.classList.add("dragging");
}

export function onDragOver(e: DragEvent): void {
  if (!dragPayload) return;
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]:not([data-locked]), [data-drop-remove]");
  document.querySelectorAll(".drop-hover").forEach((x) => x !== target && x.classList.remove("drop-hover"));
  if (!target || (target.dataset.dropRemove && !dragPayload.from)) return;
  e.preventDefault();
  target.classList.add("drop-hover");
}

export function onDrop(e: DragEvent): void {
  const payload = dragPayload;
  onDragEnd();
  if (!payload) return;
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]:not([data-locked]), [data-drop-remove]");
  if (!target) return;
  e.preventDefault();
  if (target.dataset.dropRemove && payload.from) {
    const [emp, day] = payload.from.split("|");
    const prev = entryFor(emp, day)?.shift;
    if (setShift(emp, day, null) && prev) { rerender(); toast(t("Shift removed"), () => { setShift(emp, day, prev); rerender(); }); }
    return;
  }
  const [emp, day] = (target.dataset.cell ?? "").split("|");
  if (payload.shift) {
    const prev = entryFor(emp, day)?.shift ?? null;
    if (setShift(emp, day, payload.shift)) { rerender(); toast(t("Shift added"), () => { setShift(emp, day, prev); rerender(); }); }
  } else if (payload.from) {
    const [fe, fd] = payload.from.split("|");
    const moved = entryFor(fe, fd)?.shift;
    const replaced = entryFor(emp, day)?.shift ?? null;
    if (moved && moveShift(fe, fd, emp, day)) {
      rerender();
      toast(t("Shift moved"), () => { setShift(emp, day, replaced); setShift(fe, fd, moved); rerender(); });
    }
  }
}

export function onDragEnd(): void {
  dragPayload = null;
  document.body.classList.remove("dragging");
  document.querySelectorAll(".drop-hover").forEach((x) => x.classList.remove("drop-hover"));
}

export const closeCellMenu = (): boolean => {
  if (!menuFor) return false;
  const key = menuFor;
  menuFor = null;
  rerender(`[data-action="cell-menu"][data-value="${key}"]`);
  return true;
};

export const scheduleActions: ActionMap = {
  week: (el) => { state.week = addDays(state.week, Number(el.dataset.value)); menuFor = null; rerender(`[data-action="week"][data-value="${el.dataset.value}"]`); },
  "week-now": () => { state.week = weekStart(today()); rerender(); },
  "copy-week": () => {
    const n = copyPreviousWeek();
    rerender('[data-action="copy-week"]');
    toast(n ? t("Copied {n} shifts from last week", { n }) : t("Nothing to copy: cells are already planned or in the past."));
  },
  "plan-group": (el) => {
    const v = el.dataset.value;
    group = v === "SALES" || v === "KITCHEN" || v === "OTHER" ? v : "ALL";
    rerender(`[data-action="plan-group"][data-value="${group}"]`);
  },
  "cell-menu": (el) => {
    const key = el.dataset.value ?? "";
    menuFor = menuFor === key ? null : key;
    rerender(menuFor ? `.cell-menu [role="menuitem"]` : `[data-action="cell-menu"][data-value="${key}"]`);
  },
  "cell-set": (el) => {
    const [emp, day, code] = (el.dataset.value ?? "").split("|");
    const prev = entryFor(emp, day)?.shift ?? null;
    const next = code === "OFF" ? null : isShift(code) ? code : null;
    menuFor = null;
    if (setShift(emp, day, next)) {
      rerender(`[data-action="cell-menu"][data-value="${emp}|${day}"]`);
      toast(next ? t("Shift added") : t("Shift removed"), () => { setShift(emp, day, prev); rerender(); });
    }
  },
};

export const isMenuOpen = (): boolean => menuFor !== null;
export const focusFirstMenuItem = (): void => { $<HTMLElement>(".cell-menu [role=menuitem]")?.focus(); };
