/* Performance & disciplinary logs: reviews (1–5), commendations,
   void / cancellation incidents linked from the Branch Manager Dashboard,
   lateness, warnings and general incident reports. A scorecard per
   person (punctuality, rating, incidents) sits above the log. */

import { t, tk } from "../i18n";
import { addDays, today } from "../format";
import { LOG_COLOR, LOG_IDS, NEGATIVE_LOGS, isLogType } from "../catalog";
import { branchStaff, db, employee, latestRating, punctuality, removeLog, state } from "../store";
import { esc, icon } from "../ui/dom";
import { avatar, dot, empty, pill, roleName, seg, staffCell, stampOf, stars } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "../ui/modal-bus";

const SEV_KIND = { LOW: "muted", MEDIUM: "warn", HIGH: "bad" } as const;

export function logItem(l: (typeof db.logs)[number], showPerson = true): string {
  return `<li class="log-item row-hover" style="--log:${LOG_COLOR[l.type]}">
    <div class="log-top">
      <span class="log-type">${dot(LOG_COLOR[l.type])}${esc(tk(`log.${l.type}`))}</span>
      ${l.rating ? stars(l.rating) : ""}
      ${l.type !== "REVIEW" && l.type !== "COMMENDATION" ? pill(SEV_KIND[l.severity], esc(tk(`sev.${l.severity}`))) : ""}
      ${l.source === "MANAGER_MODULE" ? `<span class="linked">${icon("arrow")} ${t("Linked from Branch Manager Dashboard")}${l.reference ? ` · <span class="mono">${esc(l.reference)}</span>` : ""}</span>` : ""}
    </div>
    ${showPerson ? `<div class="log-who">${staffCell(l.employeeId)}</div>` : ""}
    <p class="log-note">${esc(l.note)}</p>
    <div class="log-foot">${stampOf(l.loggedBy, l.timestamp, t("Logged by"))}
      <button type="button" class="btn small ghost icon-btn" data-action="log-delete" data-value="${l.id}" aria-label="${t("Delete entry")}">${icon("trash")}</button></div>
  </li>`;
}

export function renderPerformance(): string {
  const staff = branchStaff();
  const since = addDays(today(), -30);
  const logs = db.logs
    .filter((l) => employee(l.employeeId)?.branchId === state.branch)
    .filter((l) => state.logType === "ALL" || l.type === state.logType)
    .filter((l) => state.logEmployee === "ALL" || l.employeeId === state.logEmployee);
  const voids = db.logs.filter((l) => l.type === "VOID_INCIDENT" && l.timestamp.slice(0, 10) >= since && employee(l.employeeId)?.branchId === state.branch).length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Performance & incidents")}</h1>
      <p>${t("Reviews, commendations, void / cancellation incidents from the manager module, lateness and incident reports.")}</p></div>
      <div class="head-controls"><button type="button" class="btn primary" data-action="add-log">${icon("plus")} ${t("New entry")}</button></div></div>
    <section class="card">
      <div class="card-head"><div><h2>${t("Scorecards")}</h2><p>${t("Last 30 days")} · ${t("{n} void incidents", { n: voids })}</p></div></div>
      <div class="score-grid">${staff.filter((e) => e.role !== "ADMIN").map((e) => {
        const p = punctuality(e.id);
        const r = latestRating(e.id);
        const neg = db.logs.filter((l) => l.employeeId === e.id && NEGATIVE_LOGS.has(l.type) && l.timestamp.slice(0, 10) >= since).length;
        const pos = db.logs.filter((l) => l.employeeId === e.id && l.type === "COMMENDATION" && l.timestamp.slice(0, 10) >= since).length;
        return `<button type="button" class="score-card" data-action="log-person" data-value="${e.id}" aria-pressed="${state.logEmployee === e.id}">
          <span class="sc-top">${avatar(e.id, "sm")}<span><strong>${esc(e.fullName)}</strong><small>${esc(roleName(e.role))}</small></span></span>
          <span class="sc-stats">
            <span><small>${t("On time")}</small><b class="${p.pct < 80 ? "warn-text" : ""}">${Math.round(p.pct)}%</b></span>
            <span><small>${t("Rating")}</small><b>${r ? `${r}/5` : "—"}</b></span>
            <span><small>${t("Incidents")}</small><b class="${neg ? "bad-text" : ""}">${neg}</b></span>
            <span><small>${t("Praise")}</small><b class="${pos ? "good-text" : ""}">${pos}</b></span>
          </span></button>`;
      }).join("")}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>${t("Log")}</h2><p>${state.logEmployee === "ALL" ? t("{n} entries", { n: logs.length }) : `${esc(employee(state.logEmployee)?.fullName ?? "")} · ${t("{n} entries", { n: logs.length })}`}</p></div>
        ${state.logEmployee !== "ALL" ? `<button type="button" class="btn small ghost" data-action="log-person" data-value="ALL">${icon("x")} ${t("Everyone")}</button>` : ""}</div>
      ${seg("log-type", state.logType, [["ALL", t("All")], ...LOG_IDS.map((l) => [l, tk(`log.${l}`)] as const)], t("Type"), "small wrap")}
      ${logs.length ? `<ul class="log-list">${logs.slice(0, 40).map((l) => logItem(l)).join("")}</ul>` : empty(t("No entries match"))}
    </section>`;
}

export const performanceActions: ActionMap = {
  "add-log": (el) => openModal({ kind: "log", employeeId: state.logEmployee === "ALL" ? null : state.logEmployee }, el),
  "log-type": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.logType = v === "ALL" || isLogType(v) ? v : "ALL";
    rerender(`[data-action="log-type"][data-value="${state.logType}"]`);
  },
  "log-person": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.logEmployee = state.logEmployee === v ? "ALL" : v;
    rerender(`[data-action="log-person"][data-value="${v}"]`);
  },
  "log-delete": (el) => {
    const l = db.logs.find((x) => x.id === el.dataset.value);
    if (!l) return;
    removeLog(l.id);
    rerender();
    toast(t("Entry deleted"), () => { db.logs.push(l); db.logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)); rerender(); });
  },
};
