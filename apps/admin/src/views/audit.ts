/* Activity log (sign-ins, price changes, role and account changes,
   stock overrides, settings) and manual export of records to CSV or
   JSON for off-site backup. Both follow the header branch switch. */

import type { AuditEntry, AuditKind } from "../types";
import { t, tk, tkText } from "../i18n";
import { addDays, fmtTime, localDay, today } from "../format";
import { PERMISSIONS } from "../catalog";
import { branchName, db, recordExport, state } from "../store";
import { $, esc, icon } from "../ui/dom";
import { avatar, dayLabel, empty, pill, seg, stampOf } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";
import { toast } from "../ui/toast";

const KINDS: [AuditKind, string, string][] = [
  ["LOGIN", "Sign-ins", "muted"], ["PRICE", "Price changes", "warn"], ["ROLE", "Role changes", "break"], ["USER", "Accounts", "break"],
  ["INVENTORY", "Stock overrides", "bad"], ["SETTINGS", "Settings", "good"], ["BRANCH", "Branches", "good"], ["EXPORT", "Exports", "muted"],
];
const KIND_INFO = Object.fromEntries(KINDS.map(([k, l, c]) => [k, [l, c]])) as Record<AuditKind, [string, string]>;

type Dataset = "transactions" | "audit" | "users";
type Format = "CSV" | "JSON";
let dataset: Dataset = "transactions";
let format: Format = "CSV";
let range = 30;

/** Translate a log line: catalog keys (menu.X, role.X), permission keys and plain words. */
export function auditText(a: AuditEntry): string {
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(a.vars)) {
    if (typeof v !== "string") { vars[k] = v; continue; }
    const perm = PERMISSIONS.find((p) => p.key === v);
    vars[k] = perm ? t(perm.label) : tkText(v) ? tk(v) : t(v);
  }
  return t(a.text, vars);
}

const inScope = (branchId: string): boolean => state.scope === "ALL" || branchId === state.scope;

function entries(): AuditEntry[] {
  const q = state.auditQuery.trim().toLowerCase();
  return db.audit.filter((a) => inScope(a.branchId) && (state.auditKind === "ALL" || a.kind === state.auditKind)
    && (!q || `${auditText(a)} ${db.users.find((u) => u.id === a.userId)?.fullName ?? ""}`.toLowerCase().includes(q)));
}

function logList(): string {
  const list = entries();
  if (!list.length) return empty(t("No activity matches"), t("Try another filter."));
  let day = "";
  const rows = list.slice(0, 150).map((a) => {
    const d = localDay(a.at);
    const head = d !== day ? `<li class="day-head">${esc(dayLabel(d))}</li>` : "";
    day = d;
    const [label, cls] = KIND_INFO[a.kind];
    return `${head}<li class="log-row">
      <time datetime="${esc(a.at)}" class="mono">${esc(fmtTime(a.at))}</time>
      ${avatar(a.userId, "xs")}
      <span class="log-main"><span>${esc(auditText(a))}</span><small>${esc(db.users.find((u) => u.id === a.userId)?.fullName ?? a.userId)} · ${esc(branchName(a.branchId))}</small></span>
      ${pill(cls, t(label))}</li>`;
  }).join("");
  return `<ul class="log-list">${rows}</ul>${list.length > 150 ? `<p class="meta">${t("Showing the latest 150 of {n} entries.", { n: list.length })}</p>` : ""}`;
}

/* ---------- export ---------- */

function rowsFor(): Record<string, string | number | boolean>[] {
  const from = addDays(today(), -range);
  if (dataset === "transactions") return db.transactions.filter((x) => inScope(x.branchId) && localDay(x.at) >= from).map((x) => ({
    receipt_no: x.receiptNo, date_time: x.at, branch: branchName(x.branchId), cashier: db.users.find((u) => u.id === x.cashierId)?.fullName ?? x.cashierId,
    payment_method: tk(`pay.${x.method}`), items: x.items, subtotal_etb: x.subtotal, vat_etb: x.vat, total_etb: x.total,
  }));
  if (dataset === "audit") return db.audit.filter((a) => inScope(a.branchId) && localDay(a.at) >= from).map((a) => ({
    date_time: a.at, user: db.users.find((u) => u.id === a.userId)?.fullName ?? a.userId, branch: branchName(a.branchId), type: a.kind, activity: auditText(a),
  }));
  return db.users.filter((u) => inScope(u.assignedBranchId)).map((u) => ({
    id: u.id, full_name: u.fullName, username: u.username, role: u.role, branch: branchName(u.assignedBranchId), active: u.isActive, phone: u.phone,
  }));
}

const csvCell = (v: string | number | boolean): string => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function download(): void {
  const rows = rowsFor();
  if (!rows.length) { toast(t("Nothing to export for this choice.")); return; }
  const stampName = `${dataset}-${state.scope === "ALL" ? "all-branches" : branchName(state.scope).toLowerCase().replace(/\s+/g, "-")}-${today()}`;
  const body = format === "CSV"
    ? "﻿" + [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\r\n")
    : JSON.stringify({ exportedAt: new Date().toISOString(), business: db.profile.businessName, tin: db.profile.tinNumber, dataset, rows }, null, 2);
  try {
    const blob = new Blob([body], { type: format === "CSV" ? "text/csv;charset=utf-8" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${stampName}.${format.toLowerCase()}`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch { /* download blocked: still logged below */ }
  recordExport(DATASETS[dataset], format, rows.length);
  rerender('[data-action="export"]');
  toast(t("{n} rows exported as {f}", { n: rows.length.toLocaleString("en-US"), f: format }));
}

const DATASETS: Record<Dataset, string> = { transactions: "Transactions", audit: "Activity log", users: "Users" };

function exportCard(): string {
  const n = rowsFor().length;
  const lb = db.lastBackup;
  return `<section class="card export-card" aria-labelledby="exTitle">
    <div class="card-head"><div><h2 id="exTitle">${t("Export & backup")}</h2><p>${t("Download records to keep a copy off-site.")}</p></div></div>
    <div class="form">
      <div class="field"><span class="label" id="dsLbl">${t("Records")}</span>${seg("ex-dataset", dataset, (Object.keys(DATASETS) as Dataset[]).map((k) => [k, t(DATASETS[k])] as const), t("Records"), "lg")}</div>
      ${dataset === "users" ? "" : `<div class="field"><span class="label">${t("Period")}</span>${seg("ex-range", String(range), [["7", t("7 days")], ["30", t("30 days")], ["90", t("90 days")]], t("Period"), "lg")}</div>`}
      <div class="field"><span class="label">${t("Format")}</span>${seg("ex-format", format, [["CSV", t("CSV (Excel)")], ["JSON", "JSON"]], t("Format"), "lg")}</div>
      <p class="export-sum">${t("{n} rows · {b}", { n: n.toLocaleString("en-US"), b: state.scope === "ALL" ? t("All branches") : esc(branchName(state.scope)) })}</p>
      <button type="button" class="btn primary" data-action="export" ${n ? "" : "disabled"}>${icon("arrow")} ${t("Download {f}", { f: format })}</button>
      <p class="meta">${lb ? `${t("Last export")}: ${stampOf(lb.userId, lb.at)} · ${esc(t(lb.what))}` : t("No export yet in this session.")}</p>
    </div>
  </section>`;
}

export function renderAudit(): string {
  const all = db.audit.filter((a) => inScope(a.branchId));
  const since = addDays(today(), -7);
  const week = all.filter((a) => localDay(a.at) >= since);
  const c = (k: AuditKind): number => week.filter((a) => a.kind === k).length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Activity & backup")}</h1>
      <p>${t("Who did what, and when. Export records for off-site backup.")}</p></div></div>
    <div class="mini-kpis">
      <div class="card"><span class="label">${t("Sign-ins (7 days)")}</span><strong>${c("LOGIN")}</strong></div>
      <div class="card"><span class="label">${t("Price changes")}</span><strong>${c("PRICE")}</strong></div>
      <div class="card"><span class="label">${t("Role & account changes")}</span><strong>${c("ROLE") + c("USER")}</strong></div>
      <div class="card ${c("INVENTORY") ? "alert" : ""}"><span class="label">${t("Stock overrides")}</span><strong>${c("INVENTORY")}</strong></div>
    </div>
    <div class="audit-layout">
      <section class="card" aria-labelledby="lgTitle">
        <div class="card-head"><div><h2 id="lgTitle">${t("System activity log")}</h2><p>${state.scope === "ALL" ? t("All branches") : esc(branchName(state.scope))}</p></div>
          <label class="search"><span class="sr">${t("Search the log")}</span>${icon("search")}<input class="input" type="search" placeholder="${t("Search name or item")}" value="${esc(state.auditQuery)}" data-bind="audit.q"></label></div>
        ${seg("audit-kind", state.auditKind, [["ALL", t("All")], ...KINDS.map(([k, l]) => [k, t(l)] as const)], t("Type"), "small wrap")}
        <div id="logList">${logList()}</div>
      </section>
      ${exportCard()}
    </div>`;
}

export function onAuditInput(key: string, value: string): void {
  if (key !== "q") return;
  state.auditQuery = value;
  const box = $("#logList"); if (box) box.innerHTML = logList();
}

export const auditActions: ActionMap = {
  "audit-kind": (el) => { const v = el.dataset.value ?? "ALL"; state.auditKind = (KINDS.some(([k]) => k === v) ? v : "ALL") as UiKind; rerender(`[data-action="audit-kind"][data-value="${state.auditKind}"]`); },
  "ex-dataset": (el) => { const v = el.dataset.value; if (v === "transactions" || v === "audit" || v === "users") { dataset = v; rerender(`[data-action="ex-dataset"][data-value="${v}"]`); } },
  "ex-range": (el) => { const v = Number(el.dataset.value); if ([7, 30, 90].includes(v)) { range = v; rerender(`[data-action="ex-range"][data-value="${v}"]`); } },
  "ex-format": (el) => { const v = el.dataset.value; if (v === "CSV" || v === "JSON") { format = v; rerender(`[data-action="ex-format"][data-value="${v}"]`); } },
  export: () => download(),
};
type UiKind = typeof state.auditKind;
