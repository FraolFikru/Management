/* Audit trail: every sign-in, record, deletion and approval with
   who did it, their role, and when. Filterable by person and type. */

import type { AuditAction, AuditEntity, AuditEntry } from "../types";
import { t, tk } from "../i18n";
import { localDay, money, num, relDay, fmtTime } from "../format";
import { STAFF } from "../catalog";
import { db, state } from "../store";
import { esc, icon, type IconName } from "../ui/dom";
import { roleName, seg } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";

const ACTION_TEXT: Record<AuditAction, string> = {
  SIGN_IN: "signed in",
  SIGN_OUT: "signed out",
  CREATE: "recorded",
  DELETE: "deleted",
  RESTORE: "restored",
  APPROVE: "approved",
  REJECT: "rejected",
};

const ENTITY_TEXT: Record<AuditEntity, string> = {
  SESSION: "Session",
  PURCHASE: "Purchase",
  WASTE: "Waste report",
  EXPENSE: "Other expense",
  ITEM: "Catalog item",
};

const ENTITY_ICON: Record<AuditEntity, IconName> = {
  SESSION: "user", PURCHASE: "box", WASTE: "trash", EXPENSE: "coin", ITEM: "tags",
};

/** Localized description of the record an entry refers to. */
function subject(a: AuditEntry): string {
  const name = a.detail.name ?? "";
  const label = name.includes(".") ? tk(name) : name; // catalog keys contain a dot
  const qty = a.detail.quantity !== undefined ? ` · ${num(a.detail.quantity)} ${tk(`unit.${a.detail.unit ?? ""}`)}` : "";
  return `${esc(label)}${esc(qty)}`;
}

export function auditLine(a: AuditEntry): string {
  const staff = STAFF.find((s) => s.userId === a.userId);
  return `<li class="act-row">
    <span class="act-ic ${a.action.toLowerCase()}">${icon(ENTITY_ICON[a.entity])}</span>
    <span class="act-text">
      <span><strong>${esc(a.userName)}</strong> <span class="role-tag role-${a.role.toLowerCase()}">${esc(roleName(a.role))}</span>
        ${t(ACTION_TEXT[a.action])} ${a.entity === "SESSION" ? "" : `<span class="meta">${t(ENTITY_TEXT[a.entity])}</span> ${subject(a)}`}</span>
      <small>${relDay(localDay(a.timestamp))} · ${fmtTime(a.timestamp)}${staff ? "" : ""}</small>
    </span>
    ${a.detail.amount !== undefined ? `<span class="num ${a.action === "DELETE" || a.action === "REJECT" ? "neg" : ""}">${money(a.detail.amount)}</span>` : ""}
  </li>`;
}

export function renderAudit(): string {
  const rows = db.audit.filter((a) =>
    (state.auditUser === "ALL" || a.userId === state.auditUser) && (state.auditEntity === "ALL" || a.entity === state.auditEntity));
  const shown = rows.slice(0, state.auditLimit);
  const entities: AuditEntity[] = ["PURCHASE", "WASTE", "EXPENSE", "SESSION"];
  const perUser = STAFF.map((s) => ({ s, n: db.audit.filter((a) => a.userId === s.userId && localDay(a.timestamp) === localDay(new Date().toISOString())).length }));

  return `
    <div class="page-head"><div><h1>${t("Audit trail")}</h1><p>${t("Who recorded, changed or approved what, and when.")}</p></div></div>
    <section class="staff-strip" aria-label="${t("Activity today by person")}">
      ${perUser.map(({ s, n }) => `<button type="button" class="staff-chip" data-action="audit-user" data-value="${s.userId}" aria-pressed="${state.auditUser === s.userId}">
        <span class="avatar" aria-hidden="true">${s.initials}</span><span><strong>${esc(s.name)}</strong><small>${esc(roleName(s.role))} · ${t("{n} actions today", { n })}</small></span></button>`).join("")}
    </section>
    <section class="card" aria-labelledby="auditTitle">
      <div class="card-head"><div><h2 id="auditTitle">${t("Activity log")}</h2><p>${t("Showing {x} of {y}", { x: shown.length, y: rows.length })}</p></div>
        <div class="head-tools">
          ${state.auditUser !== "ALL" ? `<button type="button" class="btn small" data-action="audit-user" data-value="ALL">${icon("x")} ${t("All staff")}</button>` : ""}
          ${seg("audit-entity", state.auditEntity, [["ALL", t("All")], ...entities.map((e) => [e, t(ENTITY_TEXT[e])] as const)], t("Record type"), "small wrap")}
        </div></div>
      ${shown.length ? `<ul class="activity">${shown.map(auditLine).join("")}</ul>` : `<div class="empty"><strong>${t("Nothing recorded yet")}</strong></div>`}
      ${rows.length > shown.length ? `<div class="table-foot"><span></span><button type="button" class="btn small" data-action="audit-more">${t("Show more")}</button></div>` : ""}
    </section>
    <p class="meta fine">${t("The audit trail is read-only. Deleted records stay listed here with the name of the person who deleted them.")}</p>`;
}

export const auditActions: ActionMap = {
  "audit-user": (el) => { state.auditUser = el.dataset.value ?? "ALL"; state.auditLimit = 25; rerender(); },
  "audit-entity": (el) => { state.auditEntity = (el.dataset.value ?? "ALL") as AuditEntity | "ALL"; state.auditLimit = 25; rerender(`[data-action="audit-entity"][data-value="${state.auditEntity}"]`); },
  "audit-more": () => { state.auditLimit += 25; rerender(); },
};
