/* Employee directory: search, filter by role and status, add / edit /
   view profiles, activate or deactivate. Pay shown as hourly rate or
   monthly salary. */

import { t, tk } from "../i18n";
import { normalize } from "../format";
import { ROLE_COLOR, ROLE_IDS, isRole } from "../catalog";
import { db, latestRating, punctuality, setStatus, state, user } from "../store";
import { $, esc, icon } from "../ui/dom";
import { dot, empty, payLabel, pill, roleName, seg, staffCell, stars } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "../ui/modal-bus";


function table(): string {
  const q = normalize(state.staffQuery);
  const list = db.employees
    .filter((e) => e.branchId === state.branch)
    .filter((e) => state.staffStatus === "ALL" || e.status === state.staffStatus)
    .filter((e) => state.staffRole === "ALL" || e.role === state.staffRole)
    .filter((e) => !q || normalize(`${e.fullName} ${e.phone} ${e.email} ${e.id}`).includes(q))
    .sort((a, b) => ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role) || a.fullName.localeCompare(b.fullName));
  if (!list.length) return empty(t("No staff match"), t("Try another search or filter."));
  return `<div class="table-wrap"><table class="data staff-table">
    <caption class="sr">${t("Staff directory")}</caption>
    <thead><tr><th scope="col">${t("Full Name")}</th><th scope="col">${t("Role")}</th><th scope="col">${t("Contact")}</th>
      <th scope="col" class="num">${t("Base wage / salary")}</th><th scope="col">${t("Punctuality")}</th><th scope="col">${t("Rating")}</th><th scope="col">${t("Status")}</th>
      <th scope="col"><span class="sr">${t("Actions")}</span></th></tr></thead>
    <tbody>${list.map((e) => {
      const p = punctuality(e.id);
      const r = latestRating(e.id);
      return `<tr class="${e.status === "INACTIVE" ? "muted-row" : ""}">
        <th scope="row"><button type="button" class="link-btn" data-action="view-profile" data-value="${e.id}">${staffCell(e.id, false)}</button></th>
        <td>${dot(ROLE_COLOR[e.role])}${esc(roleName(e.role))}</td>
        <td class="contact"><a href="tel:${esc(e.phone.replace(/\s/g, ""))}">${esc(e.phone)}</a><small>${esc(e.email)}</small></td>
        <td class="num">${payLabel(e)}</td>
        <td>${p.shifts ? `<span class="${p.pct < 80 ? "warn-text" : ""}">${Math.round(p.pct)}%</span><small class="sub">${t("{n} late", { n: p.late })}${p.absent ? ` · ${t("{n} absent", { n: p.absent })}` : ""}</small>` : "—"}</td>
        <td>${r ? stars(r) : "—"}</td>
        <td>${e.status === "ACTIVE" ? pill("good", t("Active")) : pill("muted", t("Inactive"))}</td>
        <td><div class="row-actions">
          <button type="button" class="btn small ghost" data-action="edit-employee" data-value="${e.id}">${icon("edit")} ${t("Edit")}</button>
          <button type="button" class="btn small ghost" data-action="toggle-status" data-value="${e.id}">${e.status === "ACTIVE" ? t("Deactivate") : t("Reactivate")}</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

export function renderStaff(): string {
  const mine = db.employees.filter((e) => e.branchId === state.branch);
  const active = mine.filter((e) => e.status === "ACTIVE");
  const byRole = ROLE_IDS.map((r) => [r, active.filter((e) => e.role === r).length] as const).filter(([, n]) => n);
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Staff directory")}</h1>
      <p>${esc(tk(`branch.${state.branch}`))} · ${t("{n} active, {m} inactive", { n: active.length, m: mine.length - active.length })}</p></div>
      <div class="head-controls"><button type="button" class="btn primary" data-action="add-employee">${icon("plus")} ${t("Add employee")}</button></div></div>
    <div class="role-strip">${byRole.map(([r, n]) => `<button type="button" class="role-card" data-action="staff-role" data-value="${r}" aria-pressed="${state.staffRole === r}">
      ${dot(ROLE_COLOR[r])}<span>${esc(roleName(r))}</span><strong>${n}</strong></button>`).join("")}</div>
    <section class="card">
      <div class="filters">
        <label class="search">${icon("search")}<span class="sr">${t("Search staff")}</span>
          <input id="staffSearch" type="search" autocomplete="off" placeholder="${t("Search name, phone or ID")}" value="${esc(state.staffQuery)}" data-bind="staff.query"></label>
        <select class="input" data-bind="staff.role" aria-label="${t("Role")}"><option value="ALL">${t("All roles")}</option>${ROLE_IDS.map((r) => `<option value="${r}" ${state.staffRole === r ? "selected" : ""}>${esc(roleName(r))}</option>`).join("")}</select>
        ${seg("staff-status", state.staffStatus, [["ACTIVE", t("Active")], ["INACTIVE", t("Inactive")], ["ALL", t("All")]], t("Status"), "small")}
      </div>
      <div id="staffTable">${table()}</div>
    </section>`;
}

export function onStaffInput(key: string, value: string): void {
  if (key === "query") {
    state.staffQuery = value;
    const box = $("#staffTable");
    if (box) box.innerHTML = table();
  } else if (key === "role") {
    state.staffRole = isRole(value) ? value : "ALL";
    rerender("[data-bind='staff.role']");
  }
}

export const staffActions: ActionMap = {
  "add-employee": (el) => openModal({ kind: "employee", id: null }, el),
  "edit-employee": (el) => openModal({ kind: "employee", id: el.dataset.value ?? null }, el),
  "view-profile": (el) => openModal({ kind: "profile", id: el.dataset.value ?? "" }, el),
  "staff-role": (el) => {
    const v = el.dataset.value ?? "";
    state.staffRole = state.staffRole === v || !isRole(v) ? "ALL" : v;
    rerender(`[data-action="staff-role"][data-value="${v}"]`);
  },
  "staff-status": (el) => {
    const v = el.dataset.value;
    state.staffStatus = v === "INACTIVE" || v === "ALL" ? v : "ACTIVE";
    rerender(`[data-action="staff-status"][data-value="${state.staffStatus}"]`);
  },
  "toggle-status": (el) => {
    const e = db.employees.find((x) => x.id === el.dataset.value);
    if (!e) return;
    const prev = e.status;
    const shiftsBefore = db.schedule.filter((s) => s.employeeId === e.id);
    setStatus(e.id, prev === "ACTIVE" ? "INACTIVE" : "ACTIVE");
    rerender();
    toast(prev === "ACTIVE" ? t("{name} deactivated · future shifts removed · by {by}", { name: e.fullName, by: user().fullName })
      : t("{name} reactivated · by {by}", { name: e.fullName, by: user().fullName }), () => {
      e.status = prev;
      db.schedule = [...db.schedule.filter((s) => s.employeeId !== e.id), ...shiftsBefore];
      rerender();
    });
  },
};
