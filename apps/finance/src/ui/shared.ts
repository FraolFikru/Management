/* Widgets shared by several screens: user stamps, pills, segmented
   controls, metric cards, bars, the change chip and form-error helpers. */

import type { FieldErrors } from "../types";
import { monthName, t } from "../i18n";
import { fmtDay, fmtTime, localDay, money, parseDay, relDay, today } from "../format";
import { state, userName } from "../store";
import { $, esc, icon, type IconName } from "./dom";

export const dot = (color: string): string => `<i class="dot" style="background:${color}"></i>`;
export const empty = (title: string, body = ""): string => `<div class="empty"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`;
export const initials = (name: string): string => name.split(/\s+/).map((p) => p[0] ?? "").slice(0, 2).join("").toUpperCase();
export const avatar = (id: string, size = ""): string => `<span class="avatar ${size}" aria-hidden="true">${esc(initials(userName(id)))}</span>`;

export const monthLabel = (m: string): string => { const d = parseDay(`${m}-01`); return `${monthName(d.getMonth())} ${d.getFullYear()}`; };
export const dayLabel = (day: string): string => { const r = relDay(day); const f = fmtDay(day); return r === f ? f : `${r} · ${f}`; };

/** Accountability stamp: avatar · Name (ID) · time. */
export function stampOf(userId: string, iso: string, label = ""): string {
  const day = localDay(iso);
  const when = `${day === today() ? "" : `${relDay(day)} `}${fmtTime(iso)}`;
  return `<span class="byline">${label ? `<span class="by-label">${esc(label)}</span>` : ""}${avatar(userId, "xs")}${esc(userName(userId))}
    <span class="staff-id">${esc(userId)}</span> · <time datetime="${esc(iso)}">${esc(when)}</time></span>`;
}

export const pill = (kind: string, label: string): string => `<span class="pill ${kind}">${label}</span>`;

export function seg(action: string, current: string, options: readonly (readonly [string, string])[], label: string, extra = ""): string {
  return `<div class="seg ${extra}" role="group" aria-label="${esc(label)}">${options
    .map(([v, l]) => `<button type="button" data-action="${action}" data-value="${esc(v)}" aria-pressed="${current === v}">${l}</button>`).join("")}</div>`;
}

export function changePct(cur: number, prev: number): number | null {
  if (!prev || (cur < 0) !== (prev < 0)) return null; // no % when the sign flips
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export function chip(change: number | null, higherIsGood: boolean): string {
  if (change === null || !Number.isFinite(change)) return `<span class="chip flat">—</span>`;
  if (Math.abs(change) < 0.05) return `<span class="chip flat">0%</span>`;
  const up = change > 0;
  return `<span class="chip ${up === higherIsGood ? "good" : "bad"}"><span aria-hidden="true">${up ? "▲" : "▼"}</span><span class="sr">${up ? t("up") : t("down")}</span>${Math.abs(change).toFixed(1)}%</span>`;
}

export function metricCard(o: { icon: IconName; title: string; value: string; note: string; change?: string; tone?: "good" | "bad" | "warn" | ""; href?: string }): string {
  const inner = `<div class="metric-top"><span>${o.title}</span><span class="metric-ic">${icon(o.icon)}</span></div>
    <div class="metric-value ${o.tone ? `${o.tone}-text` : ""}">${o.value}</div>
    <div class="metric-foot">${o.change ?? ""}<span>${o.note}</span></div>`;
  return o.href ? `<a class="metric metric-link" href="#${o.href}">${inner}</a>` : `<article class="metric">${inner}</article>`;
}

export function bar(label: string, value: number, max: number, color: string, right = money(value, 0)): string {
  return `<div class="bar-row"><span class="bar-label">${label}</span><span class="num">${right}</span>
    <span class="bar-track" aria-hidden="true"><i style="width:${max ? Math.max(1.5, (Math.abs(value) / max) * 100) : 0}%;background:${color}"></i></span></div>`;
}

/* ---------- form errors ---------- */

export const errText = (errors: FieldErrors, key: string): string => `<p class="err" id="err-${key}">${esc(errors[key] ?? "")}</p>`;
export const invalid = (errors: FieldErrors, key: string): string => `aria-invalid="${errors[key] ? "true" : "false"}" aria-describedby="err-${key}"`;

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
