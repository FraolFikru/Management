/* Dates are handled as local calendar days ("yyyy-mm-dd"); timestamps are ISO 8601. */

import { monthName, t } from "./i18n";

const pad = (n: number): string => String(n).padStart(2, "0");

export const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDay = (day: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const today = (): string => dayOf(new Date());

/** Local calendar day of an ISO timestamp. */
export const localDay = (iso: string): string => dayOf(new Date(iso));

export const addDays = (day: string, n: number): string => {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
};

export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

/** ISO timestamp for a local day at a given hour. */
export const stamp = (day: string, hour = 12, minute = 0): string => {
  const d = parseDay(day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export const fmtDay = (day: string): string => {
  const d = parseDay(day);
  return `${monthName(d.getMonth())} ${d.getDate()}`;
};

export const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function relDay(day: string): string {
  const n = daysBetween(day, today());
  if (n === 0) return t("Today");
  if (n === 1) return t("Yesterday");
  if (n > 1 && n < 7) return t("{n} days ago", { n });
  return fmtDay(day);
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function money(n: number, digits?: number): string {
  const d = digits ?? (Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
  return `ETB ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** money with an explicit sign: "+ETB 1,200" / "−ETB 300" */
export const signedMoney = (n: number, digits?: number): string => `${n < 0 ? "−" : "+"}${money(n, digits)}`;

/** money that shows a minus only when negative */
export const moneyNeg = (n: number, digits?: number): string => `${n < 0 ? "−" : ""}${money(n, digits)}`;

export const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const pct = (n: number, digits = 1): string => `${n.toFixed(digits)}%`;

/** Parse user input like "1,250.50" → 1250.5 (NaN when empty/invalid). */
export function parseAmount(v: string): number {
  const n = parseFloat(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Plain number for an input value, "" when not finite. */
export const plain = (n: number): string => (Number.isFinite(n) ? String(round2(n)) : "");

export const normalize = (s: string): string => s.toLowerCase().trim();
