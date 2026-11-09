/* User audit trail: every dispatch decision, purchase review, waste log,
   expense, undo and user switch — with staff ID and time. */

import type { AuditAction, AuditEntry } from "../types";
import { t, tk } from "../i18n";
import { fmtDay, localDay, money } from "../format";
import { STAFF } from "../catalog";
import { db, state } from "../store";
import { esc, icon, type IconName } from "../ui/dom";
import { empty, qtyUnit, roleName, seg, stampOf } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";

const ACTION: Record<AuditAction, { label: string; icon: IconName; cls: string }> = {
  APPROVE_DISPATCH: { label: "approved dispatch", icon: "truck", cls: "good" },
  REJECT_DISPATCH: { label: "rejected dispatch", icon: "x", cls: "bad" },
  APPROVE_PURCHASE: { label: "approved purchase", icon: "check", cls: "good" },
  FLAG_PURCHASE: { label: "flagged purchase", icon: "flag", cls: "warn" },
  LOG_WASTE: { label: "logged waste", icon: "trash", cls: "warn" },
  LOG_EXPENSE: { label: "logged expense", icon: "coin", cls: "" },
  UNDO: { label: "undid", icon: "arrow", cls: "" },
  SWITCH_USER: { label: "signed in", icon: "user", cls: "" },
};

export function auditLine(a: AuditEntry): string {
  const def = ACTION[a.action];
  const what = [
    a.itemKey ? `<strong>${esc(tk(a.itemKey))}</strong>` : "",
    a.quantity !== undefined && a.unit ? qtyUnit(a.quantity, a.unit) : "",
    a.destination ? `→ ${esc(tk(`dest.${a.destination}`))}` : "",
    a.action === "LOG_EXPENSE" && a.text ? `<strong>${esc(t(a.text))}</strong>` : "",
    a.amount !== undefined ? `<span class="num">${money(a.amount, 0)}</span>` : "",
  ].filter(Boolean).join(" · ");
  const why = (a.action === "REJECT_DISPATCH" || a.action === "FLAG_PURCHASE") && a.text ? `<small class="why">${esc(t(a.text))}</small>` : "";
  return `<li class="act-row row-hover"><span class="act-ic ${def.cls}" aria-hidden="true">${icon(def.icon)}</span>
    <div class="act-body"><p><span class="act-verb">${t(def.label)}</span> ${what}</p>${why}${stampOf(a.userId, a.timestamp)}</div></li>`;
}

export function renderAudit(): string {
  const list = db.audit.filter((a) => (state.auditUser === "ALL" || a.userId === state.auditUser) && (state.auditAction === "ALL" || a.action === state.auditAction));
  const shown = list.slice(0, state.auditLimit);
  const people = STAFF.filter((s) => db.audit.some((a) => a.userId === s.userId));
  let lastDay = "";
  return `
    <div class="page-head"><div><h1>${t("Audit trail")}</h1><p>${t("Every approval, rejection, waste log and expense, with the staff ID and time.")}</p></div></div>
    <section class="card">
      <div class="audit-filters">
        <div class="field"><label for="auUser">${t("Staff")}</label>
          <select id="auUser" class="input" data-bind="audit.user"><option value="ALL">${t("Everyone")}</option>${people.map((s) =>
            `<option value="${s.userId}" ${state.auditUser === s.userId ? "selected" : ""}>${esc(s.userId)} · ${esc(s.name)} (${esc(roleName(s.role))})</option>`).join("")}</select></div>
        ${seg("audit-action", state.auditAction, [["ALL", t("All")], ["APPROVE_DISPATCH", t("Dispatch approved")], ["REJECT_DISPATCH", t("Dispatch rejected")],
          ["APPROVE_PURCHASE", t("Purchase approved")], ["FLAG_PURCHASE", t("Purchase flagged")], ["LOG_WASTE", t("Waste")], ["LOG_EXPENSE", t("Expense")]], t("Action"), "small wrap")}
      </div>
      ${shown.length ? `<ul class="activity">${shown.map((a) => {
        const day = localDay(a.timestamp);
        const head = day !== lastDay ? `<li class="day-head">${esc(fmtDay(day))}</li>` : "";
        lastDay = day;
        return head + auditLine(a);
      }).join("")}</ul>
      ${list.length > shown.length ? `<button type="button" class="btn small more" data-action="audit-more">${t("Show more ({n} left)", { n: list.length - shown.length })}</button>` : ""}`
        : empty(t("No activity matches"))}
    </section>`;
}

export function onAuditInput(key: string, value: string): void {
  if (key !== "user") return;
  state.auditUser = value;
  state.auditLimit = 40;
  rerender("#auUser");
}

export const auditActions: ActionMap = {
  "audit-action": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.auditAction = v in ACTION ? (v as AuditAction) : "ALL";
    state.auditLimit = 40;
    rerender(`[data-action="audit-action"][data-value="${state.auditAction}"]`);
  },
  "audit-more": () => { state.auditLimit += 40; rerender(); },
};
