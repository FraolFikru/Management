/* Widgets shared by several screens: staff avatars and stamps, pills,
   segmented controls, metric cards, bars, hour formatting and
   form-error helpers. */

import type { FieldErrors, UserRole } from "../types";
import { t, tk } from "../i18n";
import { fmtDay, fmtTime, localDay, money, relDay, today } from "../format";
import { ROLE_COLOR } from "../catalog";
import { employee, initials, state } from "../store";
import { $, esc, icon, type IconName } from "./dom";

export const roleName = (r: UserRole): string => tk(`role.${r}`);
export const dot = (color: string): string => `<i class="dot" style="background:${color}"></i>`;
export const empty = (title: string, body = ""): string => `<div class="empty"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`;

/** 7.5 → "7h 30m" */
export function fmtH(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}${t("h")} ${String(m).padStart(2, "0")}${t("m")}` : `${h}${t("h")}`;
}

export const avatar = (employeeId: string, size = ""): string => {
  const e = employee(employeeId);
  const color = e ? ROLE_COLOR[e.role] : "#a4acc4";
  return `<span class="avatar ${size}" style="--ring:${color}" aria-hidden="true">${esc(initials(e?.fullName ?? employeeId))}</span>`;
};

/** Name + role + ID, for table cells. */
export function staffCell(employeeId: string, showRole = true): string {
  const e = employee(employeeId);
  return `<span class="staff-cell">${avatar(employeeId, "sm")}<span><strong>${esc(e?.fullName ?? employeeId)}</strong>${
    showRole && e ? `<small>${esc(roleName(e.role))} · <span class="staff-id">${esc(e.id)}</span></small>` : `<small class="staff-id">${esc(employeeId)}</small>`}</span></span>`;
}

/** Accountability stamp: avatar · Name (ID) · time. */
export function stampOf(staffId: string, iso: string, label = ""): string {
  const day = localDay(iso);
  const when = `${day === today() ? "" : `${relDay(day)} `}${fmtTime(iso)}`;
  return `<span class="byline">${label ? `<span class="by-label">${esc(label)}</span>` : ""}${avatar(staffId, "xs")}${esc(employee(staffId)?.fullName ?? staffId)}
    <span class="staff-id">${esc(staffId)}</span> · <time datetime="${esc(iso)}">${esc(when)}</time></span>`;
}

export const dayLabel = (day: string): string => { const r = relDay(day); const f = fmtDay(day); return r === f ? f : `${r} · ${f}`; };

export function pill(kind: string, label: string): string {
  return `<span class="pill ${kind}">${label}</span>`;
}

export function seg(action: string, current: string, options: readonly (readonly [string, string])[], label: string, extra = ""): string {
  return `<div class="seg ${extra}" role="group" aria-label="${esc(label)}">${options
    .map(([v, l]) => `<button type="button" data-action="${action}" data-value="${esc(v)}" aria-pressed="${current === v}">${l}</button>`)
    .join("")}</div>`;
}

export function metricCard(o: { cls?: string; icon: IconName; title: string; value: string; note: string; href?: string; tone?: "warn" | "bad" | "good" | "" }): string {
  const inner = `<div class="metric-top"><span>${o.title}</span><span class="metric-ic">${icon(o.icon)}</span></div>
    <div class="metric-value ${o.tone ? `${o.tone}-text` : ""}">${o.value}</div><div class="metric-note">${o.note}</div>`;
  return o.href ? `<a class="metric metric-link ${o.cls ?? ""}" href="#${o.href}">${inner}</a>` : `<article class="metric ${o.cls ?? ""}">${inner}</article>`;
}

export function bar(label: string, value: number, max: number, color: string, right: string): string {
  return `<div class="bar-row"><span class="bar-label">${label}</span><span class="num">${right}</span>
    <span class="bar-track" aria-hidden="true"><i style="width:${max ? Math.max(1.5, (value / max) * 100) : 0}%;background:${color}"></i></span></div>`;
}

export const stars = (n: number): string =>
  `<span class="stars" aria-label="${t("{n} of 5", { n })}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}">★</i>`).join("")}</span>`;

/* ---------- form errors ---------- */

export const errText = (errors: FieldErrors, key: string): string => `<p class="err" id="err-${key}">${esc(errors[key] ?? "")}</p>`;
export const invalid = (errors: FieldErrors, key: string): string =>
  `aria-invalid="${errors[key] ? "true" : "false"}" aria-describedby="err-${key}"`;

export function clearErrors(keys: readonly string[]): void {
  for (const k of keys) {
    if (!state.errors[k]) continue;
    delete state.errors[k];
    const p = $(`#err-${k}`);
    if (p) p.textContent = "";
    document.querySelector(`[aria-describedby="err-${k}"]`)?.setAttribute("aria-invalid", "false");
  }
}

export function showErrors(errors: FieldErrors, order: readonly string[]): boolean {
  state.errors = errors;
  for (const k of order) {
    const p = $(`#err-${k}`);
    if (p) p.textContent = errors[k] ?? "";
    document.querySelector(`[aria-describedby="err-${k}"]`)?.setAttribute("aria-invalid", errors[k] ? "true" : "false");
  }
  const first = order.find((k) => errors[k]);
  if (first) document.querySelector<HTMLElement>(`[aria-describedby="err-${first}"]`)?.focus();
  return Boolean(first);
}

export const setPressed = (el: HTMLElement): void =>
  el.parentElement?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));

export const payLabel = (e: { payType: "HOURLY" | "MONTHLY"; hourlyRate: number; monthlySalary?: number }): string =>
  e.payType === "MONTHLY" ? `${money(e.monthlySalary ?? 0, 0)}<small>/${t("month")}</small>` : `${money(e.hourlyRate, 2)}<small>/${t("hour")}</small>`;
