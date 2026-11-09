/* =========================================================
   Live mode: the dashboard filled from the Eirsha Ops backend.
   The figures in data.ts are replaced in place, so every page
   reads the real numbers without knowing where they came from.
   ========================================================= */

import {
  budgets, buildStats, cashFlow, dailyPattern, goals, paymentMethods, peakHours, stats, topDishes, transactions, user,
  type BudgetLine, type Category, type MonthPoint, type PaymentInfo, type PaymentMethod, type When,
} from "./data";
import { loadAll } from "./api";

/** Real day-by-day and week-by-week figures for the chart (null in the demo). */
type Series = { daily: { date: string; revenue: number; expenses: number }[]; weekly: { start: string; revenue: number; expenses: number }[] };
let series: Series | null = null;
export const getLiveSeries = (): Series | null => series;

/** Budget categories → the code the backend keeps the budget on. */
export const budgetGroups: Category[] = ["Food Cost", "Labor", "Utilities", "Rent", "Marketing", "Supplies"];

const day = (iso: string): Date => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const when = (iso: string): When => {
  const d = day(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d;
};

/** Replace the demo figures with the real ones. Throws "no-access" if this account can't use the dashboard. */
export async function loadLive(): Promise<void> {
  const b = await loadAll().catch((err: unknown) => {
    throw (err as { status?: number }).status === 403 ? new Error("no-access") : err;
  });
  if (!b.role) throw new Error("no-access");
  Object.assign(user, b.user);
  cashFlow.splice(0, cashFlow.length, ...b.cashFlow);
  series = { daily: b.daily, weekly: b.weekly };
  // the weekday pattern is only used by the demo; keep it in step anyway
  const byDow = (key: "revenue" | "expenses") => {
    const out = [0, 0, 0, 0, 0, 0, 0];
    for (const x of b.daily) out[day(x.date).getDay()] = x[key];
    return out;
  };
  Object.assign(dailyPattern, { revenue: byDow("revenue"), expenses: byDow("expenses") });
  for (const k of Object.keys(b.paymentMethods) as PaymentMethod[]) {
    const p = b.paymentMethods[k];
    const info: PaymentInfo = { ...p, activity: p.activity.map((a) => ({ label: a.label, when: when(a.date), amount: a.amount })) };
    Object.assign(paymentMethods[k], info);
  }
  transactions.splice(0, transactions.length, ...b.transactions.map((x) => ({ ...x, date: day(x.date) })));
  topDishes.splice(0, topDishes.length, ...b.topDishes);
  peakHours.splice(0, peakHours.length, ...b.peakHours);
  budgets.splice(0, budgets.length, ...b.budgets.map((x): BudgetLine => ({
    category: x.category, allocated: x.allocated, spent: x.spent, lastMonth: x.lastMonth,
    ...(x.fixed ? { fixed: { committed: x.fixed.committed, paidOn: x.fixed.paidOn ? day(x.fixed.paidOn) : null } } : {}),
  })));
  goals.splice(0, goals.length, ...b.goals.map((g) => ({ ...g, deadline: g.deadline ? day(g.deadline) : null })));
  // headline cards: the last full month against the one before it
  const m = new Date().getMonth();
  const empty: MonthPoint = { month: "", revenue: 0, expenses: 0 };
  const cur = cashFlow[Math.max(0, m - 1)] ?? empty, prev = m >= 2 ? cashFlow[m - 2] : empty;
  const before = Object.values(paymentMethods).reduce((s, p) => s + p.balance / (1 + p.change / 100), 0);
  const now = Object.values(paymentMethods).reduce((s, p) => s + p.balance, 0);
  const change = before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : 0;
  stats.splice(0, stats.length, ...buildStats(cur, prev, change, m === 0 ? "this month" : "last month"));
}

