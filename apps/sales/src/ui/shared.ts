/* Widgets shared by several screens: metric cards, change chips,
   segmented controls, "logged by" stamps and form error helpers. */

import type { ExpensePaymentMethod, FieldErrors, PeriodId, Role } from "../types";
import { t, tk } from "../i18n";
import { fmtTime, localDay, money, relDay } from "../format";
import { STAFF } from "../catalog";
import { periodTotals, rangeFor, state } from "../store";
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

export const payName = (m: ExpensePaymentMethod): string => tk(`pay.${m}`);
export const roleName = (r: Role): string => tk(`role.${r}`);

/** Small "by Hanna T. · 14:32" stamp shown on every record. */
export function byline(name: string, iso: string, withDay = false): string {
  const staff = STAFF.find((s) => s.name === name);
  return `<span class="byline" title="${esc(name)}">${staff ? `<span class="avatar xs" aria-hidden="true">${staff.initials}</span>` : ""}${esc(name)} · ${
    withDay ? `${relDay(localDay(iso))} ` : ""}${fmtTime(iso)}</span>`;
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

export const periodLabel = (): string => {
  const r = rangeFor(state.period);
  return r.days === 1 ? t("vs same time yesterday") : t("vs previous {n} days", { n: r.days });
};

/* ---------- metric cards ---------- */

function card(cls: string, ic: IconName, title: string, value: string, change: string, note: string, valueCls = ""): string {
  return `<article class="metric ${cls}">
    <div class="metric-top"><span>${title}</span><span class="metric-ic">${icon(ic)}</span></div>
    <div class="metric-value ${valueCls}">${value}</div>
    <div class="metric-foot">${change}<span>${periodLabel()}</span></div>
    <div class="metric-note">${note}</div>
  </article>`;
}

export function metricsBar(): string {
  const { cur, prev } = periodTotals();
  return `<section class="metrics" aria-labelledby="metricsTitle"><h2 class="sr" id="metricsTitle">${t("Summary")}</h2>
    <div class="metric-grid">
      ${card("m-cogs", "box", t("Purchases"), money(cur.purchases, 0), chip(changePct(cur.purchases, prev.purchases), false),
        t("{n} entries", { n: cur.entries }))}
      ${card("m-exp", "coin", t("Other expenses"), money(cur.expenses, 0), chip(changePct(cur.expenses, prev.expenses), false),
        t("Repairs, fuel, transport and similar"))}
      ${card("m-waste", "trash", t("Waste & shrinkage"), money(cur.waste + cur.wastePending, 0), chip(changePct(cur.waste + cur.wastePending, prev.waste + prev.wastePending), false),
        cur.wastePending ? t("{x} awaiting approval", { x: money(cur.wastePending, 0) }) : t("All reports reviewed"))}
      ${card("m-net", "wallet", t("Total spent"), money(cur.spent, 0), chip(changePct(cur.spent, prev.spent), false),
        t("Purchases + other expenses"))}
    </div></section>`;
}

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

/** Payment method picker used by purchases and expenses. */
export function methodGrid(action: string, current: string, methods: readonly ExpensePaymentMethod[], labelId: string): string {
  return `<div class="pay-grid" role="group" aria-labelledby="${labelId}">${methods.map((m) =>
    `<button type="button" class="pay-opt" data-action="${action}" data-value="${m}" aria-pressed="${current === m}"><strong>${esc(payName(m))}</strong></button>`).join("")}</div>`;
}
