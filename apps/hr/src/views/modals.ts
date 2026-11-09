/* Dialogs: add / edit employee, employee profile, new performance entry,
   mark absent. One open at a time; focus is trapped inside and returned
   to the opener; Escape closes. */

import type { EmployeeProfile, FieldErrors, LogType, UserRole } from "../types";
import { t, tk, weekdayName } from "../i18n";
import { addDays, fmtDay, money, parseAmount, parseDay, today } from "../format";
import { BRANCHES, LOG_COLOR, LOG_IDS, MONTH_HOURS, ROLE_IDS, SHIFTS, SHIFT_COLOR, isLogType, isRole } from "../catalog";
import { workedHours } from "../seed";
import {
  addLog, db, employee, entryFor, latestRating, markAbsent, payslip, punctuality, removeLog, restoreAttendance, saveEmployee, snapshot, state, user, type Modal,
} from "../store";
import { $, $$, esc, icon } from "../ui/dom";
import { avatar, clearErrors, dot, errText, fmtH, invalid, pill, roleName, showErrors, stars } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { registerModalOpener } from "../ui/modal-bus";
import { logItem } from "./performance";
import { payLabel } from "../ui/shared";

let opener: HTMLElement | null = null;

/* ---------- drafts ---------- */

interface EmpDraft {
  fullName: string; phone: string; email: string; role: UserRole; branchId: string; payType: "HOURLY" | "MONTHLY";
  hourlyRate: string; monthlySalary: string; hireDate: string; status: "ACTIVE" | "INACTIVE";
}
let ed: EmpDraft = blankEmp();
function blankEmp(): EmpDraft {
  return { fullName: "", phone: "", email: "", role: "SALES_STAFF", branchId: state.branch, payType: "HOURLY", hourlyRate: "", monthlySalary: "", hireDate: today(), status: "ACTIVE" };
}

interface LogDraft { employeeId: string; type: LogType | ""; rating: number; severity: "LOW" | "MEDIUM" | "HIGH"; note: string; reference: string }
let ld: LogDraft = { employeeId: "", type: "", rating: 0, severity: "LOW", note: "", reference: "" };
let absentNote = "";

export function openModal(m: Exclude<Modal, null>, from: HTMLElement): void {
  opener = from;
  state.modal = m;
  state.errors = {};
  if (m.kind === "employee") {
    const e = m.id ? employee(m.id) : undefined;
    ed = e ? {
      fullName: e.fullName, phone: e.phone, email: e.email, role: e.role, branchId: e.branchId, payType: e.payType,
      hourlyRate: String(e.hourlyRate), monthlySalary: e.monthlySalary ? String(e.monthlySalary) : "", hireDate: e.hireDate, status: e.status,
    } : blankEmp();
  }
  if (m.kind === "log") ld = { employeeId: m.employeeId ?? "", type: "", rating: 0, severity: "LOW", note: "", reference: "" };
  if (m.kind === "absent") absentNote = "";
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

/* ---------- employee form ---------- */

function employeeForm(id: string | null): string {
  const e: FieldErrors = state.errors;
  const monthly = ed.payType === "MONTHLY";
  const derived = monthly && parseAmount(ed.monthlySalary) > 0 ? parseAmount(ed.monthlySalary) / MONTH_HOURS : 0;
  return `<form id="employeeForm" class="form" novalidate>
    <div class="row">
      <div class="field"><label for="eName">${t("Full Name")}</label><input id="eName" class="input" autocomplete="off" value="${esc(ed.fullName)}" data-bind="emp.fullName" ${invalid(e, "fullName")}>${errText(e, "fullName")}</div>
      <div class="field"><label for="ePhone">${t("Phone")}</label><input id="ePhone" class="input" type="tel" autocomplete="off" placeholder="+251 9XX XXX XXX" value="${esc(ed.phone)}" data-bind="emp.phone" ${invalid(e, "phone")}>${errText(e, "phone")}</div>
    </div>
    <div class="row">
      <div class="field"><label for="eEmail">${t("Email")} <span class="opt-label">${t("(optional)")}</span></label><input id="eEmail" class="input" type="email" autocomplete="off" value="${esc(ed.email)}" data-bind="emp.email" ${invalid(e, "email")}>${errText(e, "email")}</div>
      <div class="field"><label for="eHire">${t("Hire date")}</label><input id="eHire" class="input" type="date" max="${today()}" value="${esc(ed.hireDate)}" data-bind="emp.hireDate"></div>
    </div>
    <div class="row">
      <div class="field"><label for="eRole">${t("Role")}</label><select id="eRole" class="input" data-bind="emp.role">${ROLE_IDS.map((r) => `<option value="${r}" ${ed.role === r ? "selected" : ""}>${esc(roleName(r))}</option>`).join("")}</select></div>
      <div class="field"><label for="eBranch">${t("Branch Assignment")}</label><select id="eBranch" class="input" data-bind="emp.branchId">${BRANCHES.map((b) => `<option value="${b.id}" ${ed.branchId === b.id ? "selected" : ""}>${esc(tk(b.nameKey))}</option>`).join("")}</select></div>
    </div>
    <div class="field"><span class="label" id="payLbl">${t("Pay basis")}</span>
      <div class="seg" role="group" aria-labelledby="payLbl">
        <button type="button" data-action="emp-pay" data-value="HOURLY" aria-pressed="${!monthly}">${t("Hourly wage")}</button>
        <button type="button" data-action="emp-pay" data-value="MONTHLY" aria-pressed="${monthly}">${t("Monthly salary")}</button></div></div>
    <div class="row">
      ${monthly ? `<div class="field"><label for="eSalary">${t("Monthly salary")}</label>
          <div class="affix"><span>ETB</span><input id="eSalary" class="input num-in" inputmode="decimal" value="${esc(ed.monthlySalary)}" data-bind="emp.monthlySalary" ${invalid(e, "pay")}></div>
          <p class="hint" id="derivedRate">${derived ? t("Overtime hourly rate: {x} (salary ÷ 208 h)", { x: money(derived, 2) }) : t("Overtime uses salary ÷ 208 hours.")}</p>${errText(e, "pay")}</div>`
        : `<div class="field"><label for="eRate">${t("Hourly rate")}</label>
          <div class="affix"><span>ETB</span><input id="eRate" class="input num-in" inputmode="decimal" value="${esc(ed.hourlyRate)}" data-bind="emp.hourlyRate" ${invalid(e, "pay")}></div>${errText(e, "pay")}</div>`}
      <div class="field"><span class="label" id="stLbl">${t("Employment Status")}</span>
        <div class="seg" role="group" aria-labelledby="stLbl">
          <button type="button" data-action="emp-status" data-value="ACTIVE" aria-pressed="${ed.status === "ACTIVE"}">${t("Active")}</button>
          <button type="button" data-action="emp-status" data-value="INACTIVE" aria-pressed="${ed.status === "INACTIVE"}">${t("Inactive")}</button></div></div>
    </div>
    <div class="modal-foot">
      <small class="stamp">${icon("user")} ${t("Saved by {name} ({id})", { name: esc(user().fullName), id: esc(user().id) })}</small>
      <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
        <button type="submit" class="btn primary">${icon("check")} ${id ? t("Save changes") : t("Add employee")}</button></div>
    </div>
  </form>`;
}

const PHONE_RE = /^(\+251|0)\s?9\d{2}\s?\d{3}\s?\d{3}$|^(\+251|0)\s?7\d{2}\s?\d{3}\s?\d{3}$/;

export function submitEmployee(): void {
  const m = state.modal;
  if (!m || m.kind !== "employee") return;
  const errors: FieldErrors = {};
  if (ed.fullName.trim().split(/\s+/).length < 2) errors.fullName = t("Enter first and last name.");
  if (!PHONE_RE.test(ed.phone.trim())) errors.phone = t("Use an Ethiopian mobile number, e.g. +251 911 234 567.");
  if (ed.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ed.email.trim())) errors.email = t("That email address does not look right.");
  const salary = parseAmount(ed.monthlySalary);
  const rate = parseAmount(ed.hourlyRate);
  if (ed.payType === "MONTHLY" ? !(salary > 0) : !(rate > 0)) errors.pay = t("Enter an amount above 0.");
  if (showErrors(errors, ["fullName", "phone", "email", "pay"])) return;
  const data: Omit<EmployeeProfile, "id"> = {
    fullName: ed.fullName.trim().replace(/\s+/g, " "), phone: ed.phone.trim(), email: ed.email.trim(), role: ed.role, branchId: ed.branchId,
    payType: ed.payType, hourlyRate: ed.payType === "MONTHLY" ? Math.round((salary / MONTH_HOURS) * 100) / 100 : rate,
    monthlySalary: ed.payType === "MONTHLY" ? salary : undefined, hireDate: ed.hireDate || today(), status: ed.status,
  };
  const before = m.id ? { ...(employee(m.id) as EmployeeProfile) } : null;
  const saved = saveEmployee(data, m.id);
  closeModal();
  rerender();
  toast(before ? t("{name} updated · by {by}", { name: saved.fullName, by: user().fullName }) : t("{name} added as {id} · by {by}", { name: saved.fullName, id: saved.id, by: user().fullName }), () => {
    if (before) Object.assign(saved, before);
    else db.employees = db.employees.filter((x) => x !== saved);
    rerender();
  });
}

/* ---------- profile ---------- */

function profile(id: string): string {
  const e = employee(id);
  if (!e) return "";
  const p = payslip(e, today().slice(0, 7));
  const pu = punctuality(e.id);
  const r = latestRating(e.id);
  const next = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  const logs = db.logs.filter((l) => l.employeeId === e.id).slice(0, 3);
  const onClock = db.attendance.find((a) => a.employeeId === e.id && a.shiftDate === today());
  return `<div class="profile">
    <div class="pf-head">${avatar(e.id, "lg")}<div><h3>${esc(e.fullName)}</h3>
      <p>${esc(roleName(e.role))} · <span class="staff-id">${esc(e.id)}</span> · ${e.status === "ACTIVE" ? pill("good", t("Active")) : pill("muted", t("Inactive"))}</p></div></div>
    <dl class="pf-grid">
      <div><dt>${t("Phone")}</dt><dd><a href="tel:${esc(e.phone.replace(/\s/g, ""))}">${esc(e.phone)}</a></dd></div>
      <div><dt>${t("Email")}</dt><dd>${esc(e.email || "—")}</dd></div>
      <div><dt>${t("Branch Assignment")}</dt><dd>${esc(tk(`branch.${e.branchId}`))}</dd></div>
      <div><dt>${t("Hire date")}</dt><dd>${esc(fmtDay(e.hireDate))} ${e.hireDate.slice(0, 4)}</dd></div>
      <div><dt>${t("Base wage / salary")}</dt><dd>${payLabel(e)}</dd></div>
    </dl>
    <div class="pf-stats">
      <div><span>${t("Hours this month")}</span><strong>${fmtH(p.regularHours + p.overtimeHours)}</strong></div>
      <div><span>${t("Overtime")}</span><strong>${fmtH(p.overtimeHours)}</strong></div>
      <div><span>${t("Net pay so far")}</span><strong>${money(p.netPay, 0)}</strong></div>
      <div><span>${t("On time")}</span><strong class="${pu.pct < 80 ? "warn-text" : ""}">${Math.round(pu.pct)}%</strong></div>
      <div><span>${t("Rating")}</span><strong>${r ? stars(r) : "—"}</strong></div>
    </div>
    ${onClock && onClock.status !== "SCHEDULED" ? `<p class="meta">${t("Today")}: ${onClock.status === "ABSENT" ? t("Absent") : `${t("worked {h}", { h: fmtH(workedHours(onClock)) })}`}</p>` : ""}
    <h4>${t("Next 7 days")}</h4>
    <div class="pf-week">${next.map((d) => { const s = entryFor(e.id, d); return `<div class="pf-day ${s ? "" : "off"}"><small>${esc(weekdayName(parseDay(d).getDay()))}</small>
      ${s ? `<span class="shift-chip" style="--shift:${SHIFT_COLOR[s.shift]}">${esc(tk(`shift.${s.shift}`))}</span><small class="mono">${SHIFTS[s.shift].start}</small>` : `<span class="meta">${t("Off")}</span>`}</div>`; }).join("")}</div>
    <h4>${t("Recent log entries")}</h4>
    ${logs.length ? `<ul class="log-list compact">${logs.map((l) => logItem(l, false)).join("")}</ul>` : `<p class="meta">${t("No entries yet")}</p>`}
    <div class="modal-foot"><span></span><div class="form-actions">
      <button type="button" class="btn" data-action="profile-log" data-value="${e.id}">${icon("star")} ${t("New entry")}</button>
      <button type="button" class="btn primary" data-action="profile-edit" data-value="${e.id}">${icon("edit")} ${t("Edit")}</button></div></div>
  </div>`;
}

/* ---------- performance entry ---------- */

function logForm(): string {
  const e: FieldErrors = state.errors;
  const staff = db.employees.filter((x) => x.branchId === state.branch && x.status === "ACTIVE");
  const isReview = ld.type === "REVIEW";
  const severityApplies = ld.type !== "" && ld.type !== "REVIEW" && ld.type !== "COMMENDATION";
  return `<form id="logForm" class="form" novalidate>
    <div class="field"><label for="lEmp">${t("Employee")}</label>
      <select id="lEmp" class="input" data-bind="log.employeeId" ${invalid(e, "employee")}><option value="">${t("Choose…")}</option>${staff.map((s) =>
        `<option value="${s.id}" ${ld.employeeId === s.id ? "selected" : ""}>${esc(s.fullName)} · ${esc(roleName(s.role))}</option>`).join("")}</select>${errText(e, "employee")}</div>
    <div class="field"><span class="label" id="lTypeLbl">${t("Type")}</span>
      <div class="reason-grid" role="group" aria-labelledby="lTypeLbl">${LOG_IDS.map((l) =>
        `<button type="button" class="reason-opt" data-action="log-kind" data-value="${l}" aria-pressed="${ld.type === l}">${dot(LOG_COLOR[l])}${esc(tk(`log.${l}`))}</button>`).join("")}</div>${errText(e, "type")}</div>
    ${isReview ? `<div class="field"><span class="label" id="lRateLbl">${t("Rating")}</span>
      <div class="rate-pick" role="radiogroup" aria-labelledby="lRateLbl">${[1, 2, 3, 4, 5].map((n) =>
        `<button type="button" role="radio" class="${n <= ld.rating ? "on" : ""}" aria-checked="${ld.rating === n}" data-action="log-rate" data-value="${n}" aria-label="${t("{n} of 5", { n })}">★</button>`).join("")}</div>${errText(e, "rating")}</div>` : ""}
    ${severityApplies ? `<div class="field"><span class="label" id="lSevLbl">${t("Severity")}</span>
      <div class="seg" role="group" aria-labelledby="lSevLbl">${(["LOW", "MEDIUM", "HIGH"] as const).map((s) =>
        `<button type="button" data-action="log-sev" data-value="${s}" aria-pressed="${ld.severity === s}">${esc(tk(`sev.${s}`))}</button>`).join("")}</div></div>` : ""}
    ${ld.type === "VOID_INCIDENT" ? `<div class="field"><label for="lRef">${t("Ticket number")} <span class="opt-label">${t("(optional)")}</span></label>
      <input id="lRef" class="input" autocomplete="off" placeholder="T-52144" value="${esc(ld.reference)}" data-bind="log.reference"></div>` : ""}
    <div class="field"><label for="lNote">${t("Note")}</label>
      <textarea id="lNote" class="input" rows="3" placeholder="${t("What happened, or what went well?")}" data-bind="log.note" ${invalid(e, "note")}>${esc(ld.note)}</textarea>${errText(e, "note")}</div>
    <div class="modal-foot">
      <small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().fullName), id: esc(user().id) })}</small>
      <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
        <button type="submit" class="btn primary">${icon("check")} ${t("Save entry")}</button></div>
    </div>
  </form>`;
}

export function submitLog(): void {
  const errors: FieldErrors = {};
  if (!ld.employeeId) errors.employee = t("Choose the employee.");
  if (!ld.type) errors.type = t("Choose the type of entry.");
  if (ld.type === "REVIEW" && !ld.rating) errors.rating = t("Give a rating from 1 to 5.");
  if (ld.note.trim().length < 5) errors.note = t("Write a short note.");
  if (showErrors(errors, ["employee", "type", "rating", "note"]) || !ld.type) {
    if (errors.type && !errors.employee) $<HTMLElement>('[data-action="log-kind"]')?.focus();
    return;
  }
  const rec = addLog({
    employeeId: ld.employeeId, type: ld.type, severity: ld.type === "REVIEW" || ld.type === "COMMENDATION" ? "LOW" : ld.severity, note: ld.note.trim(),
    rating: ld.type === "REVIEW" ? ld.rating : undefined, source: "HR", reference: ld.reference.trim() || undefined,
  });
  closeModal();
  rerender();
  toast(t("{type} logged for {name} · by {by}", { type: tk(`log.${rec.type}`), name: employee(rec.employeeId)?.fullName ?? "", by: user().fullName }), () => { removeLog(rec.id); rerender(); });
}

/* ---------- absent ---------- */

function absentForm(id: string): string {
  const a = db.attendance.find((x) => x.id === id);
  return `<form id="absentForm" class="form" novalidate>
    <p class="modal-summary">${a ? `<strong>${esc(a.employeeName)}</strong> · ${esc(tk(`shift.${a.shift}`))} ${esc(SHIFTS[a.shift].start)}–${esc(SHIFTS[a.shift].end)}` : ""}</p>
    <div class="field"><label for="abNote">${t("Reason")} <span class="opt-label">${t("(optional — adds an incident entry)")}</span></label>
      <textarea id="abNote" class="input" rows="2" placeholder="${t("e.g. called in sick, no call / no show")}" data-bind="absent.note">${esc(absentNote)}</textarea></div>
    <div class="modal-foot"><small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().fullName), id: esc(user().id) })}</small>
      <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
        <button type="submit" class="btn danger">${t("Mark absent")}</button></div></div>
  </form>`;
}

export function submitAbsent(): void {
  const m = state.modal;
  if (!m || m.kind !== "absent") return;
  const a0 = db.attendance.find((x) => x.id === m.id);
  if (!a0) return;
  const before = snapshot(a0);
  const logsBefore = db.logs.length;
  const a = markAbsent(m.id, absentNote.trim());
  closeModal();
  if (!a) return;
  rerender();
  toast(t("{name} marked absent · by {by}", { name: a.employeeName, by: user().fullName }), () => {
    restoreAttendance(before);
    if (db.logs.length > logsBefore) db.logs.shift();
    rerender();
  });
}

/* ---------- frame ---------- */

export function renderModal(): void {
  const root = $("#modalRoot");
  const m = state.modal;
  if (!root) return;
  if (!m) { root.innerHTML = ""; return; }
  const title = m.kind === "employee" ? (m.id ? t("Edit employee") : t("Add employee"))
    : m.kind === "profile" ? t("Employee profile") : m.kind === "log" ? t("New performance entry") : t("Mark absent");
  const body = m.kind === "employee" ? employeeForm(m.id) : m.kind === "profile" ? profile(m.id) : m.kind === "log" ? logForm() : absentForm(m.id);
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-close"></div>
    <div class="modal ${m.kind === "profile" ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head"><h2 id="modalTitle">${title}</h2>
        <button type="button" class="btn icon-btn ghost" data-action="modal-close" aria-label="${t("Close")}">${icon("x")}</button></div>
      ${body}
    </div>`;
  document.body.classList.add("modal-open");
  const first = m.kind === "employee" ? "#eName" : m.kind === "log" ? (ld.employeeId ? '[data-action="log-kind"]' : "#lEmp") : m.kind === "absent" ? "#abNote" : '[data-action="profile-edit"]';
  $<HTMLElement>(first)?.focus();
}

export function onModalInput(scope: string, key: string, value: string): void {
  if (scope === "emp") {
    if (key === "role") { if (isRole(value)) { ed.role = value; renderModal(); $<HTMLElement>("#eRole")?.focus(); } return; }
    if (key in ed) (ed as unknown as Record<string, string>)[key] = value;
    const errKey = key === "hourlyRate" || key === "monthlySalary" ? "pay" : key;
    clearErrors([errKey]);
    if (key === "monthlySalary") {
      const hint = $("#derivedRate");
      const v = parseAmount(value);
      if (hint) hint.textContent = v > 0 ? t("Overtime hourly rate: {x} (salary ÷ 208 h)", { x: money(v / MONTH_HOURS, 2) }) : t("Overtime uses salary ÷ 208 hours.");
    }
  } else if (scope === "log") {
    if (key === "employeeId") { ld.employeeId = value; clearErrors(["employee"]); }
    else if (key === "note") { ld.note = value; clearErrors(["note"]); }
    else if (key === "reference") ld.reference = value;
  } else if (scope === "absent") absentNote = value;
}

export const modalActions: ActionMap = {
  "modal-close": () => closeModal(),
  "emp-pay": (el) => { ed.payType = el.dataset.value === "MONTHLY" ? "MONTHLY" : "HOURLY"; clearErrors(["pay"]); renderModal(); $<HTMLElement>(`[data-action="emp-pay"][data-value="${ed.payType}"]`)?.focus(); },
  "emp-status": (el) => { ed.status = el.dataset.value === "INACTIVE" ? "INACTIVE" : "ACTIVE"; $$<HTMLElement>('[data-action="emp-status"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el))); },
  "profile-edit": (el) => { const keep = opener; openModal({ kind: "employee", id: el.dataset.value ?? null }, keep ?? el); },
  "profile-log": (el) => { const keep = opener; openModal({ kind: "log", employeeId: el.dataset.value ?? null }, keep ?? el); },
  "log-kind": (el) => {
    const v = el.dataset.value ?? "";
    if (!isLogType(v)) return;
    ld.type = v;
    clearErrors(["type"]);
    renderModal();
    $<HTMLElement>(`[data-action="log-kind"][data-value="${v}"]`)?.focus();
  },
  "log-rate": (el) => {
    ld.rating = Number(el.dataset.value) || 0;
    clearErrors(["rating"]);
    $$<HTMLElement>('[data-action="log-rate"]').forEach((b) => { b.setAttribute("aria-checked", String(b === el)); b.classList.toggle("on", Number(b.dataset.value) <= ld.rating); });
  },
  "log-sev": (el) => {
    const v = el.dataset.value;
    if (v === "LOW" || v === "MEDIUM" || v === "HIGH") ld.severity = v;
    $$<HTMLElement>('[data-action="log-sev"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  },
};

/** Keep Tab inside the dialog and close on Escape. */
export function modalKeydown(e: KeyboardEvent): void {
  if (!state.modal) return;
  if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
  if (e.key !== "Tab") return;
  const box = $(".modal");
  if (!box) return;
  const items = $$<HTMLElement>('a[href], button:not([disabled]), input, select, textarea', box).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
