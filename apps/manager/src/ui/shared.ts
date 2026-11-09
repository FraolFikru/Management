/* Widgets shared by several screens: metric cards, change chips,
   segmented controls, staff stamps (name + staff ID + time), status
   pills, bars and form-error helpers. */

import type { FieldErrors, PaymentMethod, PeriodId, UserRole } from "../types";
import { t, tk } from "../i18n";
import { fmtTime, localDay, money, num, relDay, today } from "../format";
import { staffById } from "../catalog";
import { state } from "../store";
import { $, esc, icon, type IconName } from "./dom";

/* ---------- chips ---------- */

export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** ▲/▼ chip coloured by whether the direction is good for this metric. */
export function chip(change: number | null, higherIsGood: boolean, unit: "%" | "pts" = "%"): string {
  if (change === null || !Number.isFinite(change)) return `<span class="chip flat">—</span>`;
  if (Math.abs(change) < 0.05) return `<span class="chip flat">0${unit === "%" ? "%" : ` ${t("pts")}`}</span>`;
  const up = change > 0;
  const good = up === higherIsGood;
  const value = unit === "%" ? `${Math.abs(change).toFixed(1)}%` : `${Math.abs(change).toFixed(1)} ${t("pts")}`;
  return `<span class="chip ${good ? "good" : "bad"}"><span aria-hidden="true">${up ? "▲" : "▼"}</span><span class="sr">${up ? t("up") : t("down")}</span>${value}</span>`;
}

export const payName = (m: PaymentMethod): string => tk(`pay.${m}`);
export const roleName = (r: UserRole): string => tk(`role.${r}`);
export const unitName = (u: string): string => tk(`unit.${u}`);
export const qtyUnit = (q: number, u: string): string => `${num(q)} ${unitName(u)}`;

/** Accountability stamp: avatar · Name (ID) · time. Used on every record. */
export function stampOf(staffId: string, iso: string, label = ""): string {
  const s = staffById(staffId);
  const day = localDay(iso);
  const when = `${day === today() ? "" : `${relDay(day)} `}${fmtTime(iso)}`;
  return `<span class="byline">${label ? `<span class="by-label">${esc(label)}</span>` : ""}${s ? `<span class="avatar xs" aria-hidden="true">${s.initials}</span>` : ""}${
    esc(s?.name ?? staffId)} <span class="staff-id">${esc(staffId)}</span> · <time datetime="${esc(iso)}">${esc(when)}</time></span>`;
}

/** Name + ID without the time, e.g. for a table cell. */
export function staffCell(staffId: string): string {
  const s = staffById(staffId);
  return `<span class="staff-cell">${s ? `<span class="avatar xs" aria-hidden="true">${s.initials}</span>` : ""}<span>${esc(s?.name ?? staffId)}<small class="staff-id">${esc(staffId)}</small></span></span>`;
}

export function statusPill(status: "PENDING" | "APPROVED" | "REJECTED" | "FLAGGED"): string {
  const label = { PENDING: t("Pending"), APPROVED: t("Approved"), REJECTED: t("Rejected"), FLAGGED: t("Flagged") }[status];
  return `<span class="pill ${status.toLowerCase()}">${label}</span>`;
}

/* ---------- segmented control ---------- */

export function seg(action: string, current: string, options: readonly (readonly [string, string])[], label: string, extra = ""): string {
  return `<div class="seg ${extra}" role="group" aria-label="${esc(label)}">${options
    .map(([v, l]) => `<button type="button" data-action="${action}" data-value="${esc(v)}" aria-pressed="${current === v}">${l}</button>`)
    .join("")}</div>`;
}

const PERIOD_LABEL: Record<PeriodId, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };

export const periodSeg = (): string =>
  seg("period", state.period, (Object.keys(PERIOD_LABEL) as PeriodId[]).map((p) => [p, t(PERIOD_LABEL[p])] as const), t("Period"), "small");

export const shiftSeg = (): string =>
  seg("shift", state.shift, [["ALL", t("All shifts")], ["MORNING", tk("shift.MORNING")], ["EVENING", tk("shift.EVENING")]], t("Shift"), "small");

export const compareLabel = (p: PeriodId): string =>
  p === "today" ? t("vs same time yesterday") : t("vs previous {n} days", { n: p === "7d" ? 7 : 30 });

/* ---------- metric card & bars ---------- */

export function metricCard(o: { cls: string; icon: IconName; title: string; value: string; change: string; foot: string; note: string; action?: string }): string {
  const inner = `
    <div class="metric-top"><span>${o.title}</span><span class="metric-ic">${icon(o.icon)}</span></div>
    <div class="metric-value">${o.value}</div>
    <div class="metric-foot">${o.change}<span>${o.foot}</span></div>
    <div class="metric-note">${o.note}</div>`;
  return o.action
    ? `<a class="metric ${o.cls} metric-link" href="#${o.action}">${inner}</a>`
    : `<article class="metric ${o.cls}">${inner}</article>`;
}

export function bar(label: string, value: number, max: number, color: string, right = money(value, 0)): string {
  return `<div class="bar-row"><span class="bar-label">${label}</span><span class="num">${right}</span>
    <span class="bar-track" aria-hidden="true"><i style="width:${max ? Math.max(1.5, (value / max) * 100) : 0}%;background:${color}"></i></span></div>`;
}

export const dot = (color: string): string => `<i class="dot" style="background:${color}"></i>`;

export const empty = (title: string, body = ""): string => `<div class="empty"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`;

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
