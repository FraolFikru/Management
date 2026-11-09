/* Users & roles: the account list (filtered by the header branch
   switch) and the role × module permission matrix. Cells the rules fix
   are shown with a lock and the reason. */

import type { UserRole } from "../types";
import { t, tk } from "../i18n";
import { PERMISSIONS, ROLE_IDS, isRole, lockReason } from "../catalog";
import { activeAdmins, branchName, db, permsOf, setActive, state, togglePermission } from "../store";
import { esc, icon } from "../ui/dom";
import { avatar, empty, seg } from "../ui/shared";
import { fmtTime, localDay, relDay } from "../format";
import { openModal } from "../ui/modal-bus";
import { rerender, type ActionMap } from "../ui/app";
import { toast } from "../ui/toast";
import { renderNav } from "../ui/shell";
import { switchBtn } from "./store";

const lastLogin = (id: string): string | undefined => db.audit.find((a) => a.userId === id && a.kind === "LOGIN")?.at;

function usersTable(): string {
  const list = db.users.filter((u) => (state.scope === "ALL" || u.assignedBranchId === state.scope) && (state.userFilter === "ALL" || u.role === state.userFilter))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role) || a.fullName.localeCompare(b.fullName));
  if (!list.length) return empty(t("No users match"), t("Try another role or branch."));
  return `<div class="table-wrap"><table class="data users">
    <caption class="sr">${t("User accounts")}</caption>
    <thead><tr><th scope="col">${t("Name")}</th><th scope="col">${t("Role")}</th><th scope="col">${t("Branch")}</th><th scope="col">${t("Last sign-in")}</th><th scope="col">${t("Active")}</th><th scope="col"><span class="sr">${t("Actions")}</span></th></tr></thead>
    <tbody>${list.map((u) => {
      const ll = lastLogin(u.id);
      return `<tr class="${u.isActive ? "" : "muted-row"}">
        <th scope="row"><span class="person">${avatar(u.id, "sm")}<span><strong>${esc(u.fullName)}</strong><small class="mono">@${esc(u.username)} · ${esc(u.id)}</small></span></span></th>
        <td><span class="role-tag r-${u.role.toLowerCase()}">${esc(tk(`role.${u.role}`))}</span></td>
        <td>${esc(branchName(u.assignedBranchId))}</td>
        <td>${ll ? `<time class="nowrap" datetime="${esc(ll)}">${esc(relDay(localDay(ll)))} · ${esc(fmtTime(ll))}</time>` : `<span class="meta">${t("Never")}</span>`}</td>
        <td>${switchBtn("user-active", u.isActive, t("{name} active", { name: u.fullName }), u.id)}</td>
        <td><button type="button" class="btn small ghost" data-action="edit-user" data-value="${u.id}">${icon("edit")} ${t("Edit")}</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

function matrix(): string {
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  return `<div class="table-wrap"><table class="data matrix">
    <caption class="sr">${t("Permissions by role")}</caption>
    <thead><tr><th scope="col">${t("Module")}</th>${ROLE_IDS.map((r) => `<th scope="col" class="c">${esc(tk(`role.${r}`))}</th>`).join("")}</tr></thead>
    <tbody>${groups.map((g) => `<tr class="group"><th scope="rowgroup" colspan="${ROLE_IDS.length + 1}">${t(g)}</th></tr>
      ${PERMISSIONS.filter((p) => p.group === g).map((p) => `<tr>
        <th scope="row">${t(p.label)}<small>${t(p.hint)}</small></th>
        ${ROLE_IDS.map((r) => cell(r, p.key, t(p.label))).join("")}
      </tr>`).join("")}`).join("")}</tbody></table></div>`;
}

function cell(role: UserRole, key: (typeof PERMISSIONS)[number]["key"], label: string): string {
  const on = permsOf(role)[key];
  const why = lockReason(role, key);
  if (why) return `<td class="c locked"><span class="lock-cell ${on ? "on" : ""}" title="${esc(t(why))}" aria-label="${esc(`${label} · ${tk(`role.${role}`)}: ${on ? t("allowed") : t("not allowed")}. ${t(why)}`)}">${icon(on ? "check" : "lock")}</span></td>`;
  return `<td class="c">${switchBtn("perm", on, `${label} · ${tk(`role.${role}`)}`, `${role}|${key}`)}</td>`;
}

export function renderAccess(): string {
  const counts = (r: UserRole): number => db.users.filter((u) => u.role === r && u.isActive && (state.scope === "ALL" || u.assignedBranchId === state.scope)).length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Users & roles")}</h1>
      <p>${t("Who can sign in, their role and branch, and what each role is allowed to do.")}</p></div>
      <div class="head-controls"><button type="button" class="btn primary" data-action="add-user">${icon("plus")} ${t("Add user")}</button></div></div>
    <div class="role-strip">${ROLE_IDS.map((r) => `<button type="button" class="role-stat" data-action="user-filter" data-value="${state.userFilter === r ? "ALL" : r}" aria-pressed="${state.userFilter === r}">
      <strong>${counts(r)}</strong><span>${esc(tk(`role.${r}`))}</span></button>`).join("")}</div>
    <section class="card" aria-labelledby="usTitle">
      <div class="card-head"><div><h2 id="usTitle">${t("User accounts")}</h2><p>${state.scope === "ALL" ? t("All branches") : esc(branchName(state.scope))}</p></div>
        ${seg("user-filter", state.userFilter, [["ALL", t("All roles")], ...ROLE_IDS.map((r) => [r, tk(`role.${r}`)] as const)], t("Role"), "small wrap")}</div>
      ${usersTable()}
    </section>
    <section class="card" aria-labelledby="pmTitle">
      <div class="card-head"><div><h2 id="pmTitle">${t("Permissions by role")}</h2>
        <p>${t("Sales Staff can only make sales and request dispatch. Reports, expenses, prices and stock overrides are for Branch Managers and Admins.")}</p></div>
        <span class="legend"><span>${icon("lock")} ${t("Fixed by policy")}</span></span></div>
      ${matrix()}
    </section>`;
}

export const accessActions: ActionMap = {
  "user-filter": (el) => {
    const v = el.dataset.value;
    const prev = state.userFilter;
    state.userFilter = isRole(v) ? v : "ALL";
    // role tiles flip their value between the role and "ALL"; keep focus on the tile that was pressed
    rerender(el.classList.contains("role-stat")
      ? `.role-stat[data-value="${state.userFilter === "ALL" ? prev : "ALL"}"]`
      : `.seg [data-action="user-filter"][data-value="${state.userFilter}"]`);
  },
  perm: (el) => {
    const [role, key] = (el.dataset.value ?? "").split("|");
    const meta = PERMISSIONS.find((p) => p.key === key);
    if (!isRole(role) || !meta) return;
    const res = togglePermission(role, meta.key);
    if (!res) return;
    el.setAttribute("aria-checked", String(res.value));
    toast(t("{perm} turned {state} for {role}", { perm: t(meta.label), state: t(res.value ? "on" : "off"), role: tk(`role.${role}`) }), () => { res.undo(); rerender(); });
  },
  "user-active": (el) => {
    const u = db.users.find((x) => x.id === el.dataset.value);
    if (!u) return;
    if (u.isActive && u.id === state.userId) { toast(t("You can't deactivate your own account.")); return; }
    if (u.isActive && u.role === "ADMIN" && activeAdmins().length <= 1) { toast(t("Keep at least one active Admin.")); return; }
    const undo = setActive(u.id, !u.isActive);
    rerender(`[data-action="user-active"][data-value="${u.id}"]`);
    renderNav();
    toast(u.isActive ? t("{name} can sign in again", { name: u.fullName }) : t("{name} can no longer sign in", { name: u.fullName }), () => { undo(); rerender(); renderNav(); });
  },
  "add-user": (el) => openModal({ kind: "user", id: null }, el),
  "edit-user": (el) => openModal({ kind: "user", id: el.dataset.value ?? null }, el),
};
