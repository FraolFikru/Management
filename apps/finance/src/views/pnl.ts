/* Profit & loss: net revenue, COGS, operating expenses and net profit
   for the chosen period, recalculated from the books on every render
   (so a new bill shows up at once). Statement with the previous period
   side by side, a six-month trend, and the cost structure. */

import type { Pnl } from "../store";
import { t, tk } from "../i18n";
import { money, pct } from "../format";
import { COGS_IDS, COLORS, OPEX_IDS, PROFIT_TAX_RATE } from "../catalog";
import { monthlyTrend, periodRange, pnl, state, type PeriodId } from "../store";
import { esc } from "../ui/dom";
import { bar, changePct, chip, dayLabel, metricCard, monthLabel, seg } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";

const PERIODS: [PeriodId, string][] = [["this", "Month to date"], ["last", "Last month"], ["q", "Last 3 months"], ["fy", "Fiscal year to date"]];

const signed = (n: number): string => `${n < 0 ? "−" : ""}${money(n, 0)}`;

function line(label: string, cur: number, prev: number | null, o: { cls?: string; neg?: boolean; sub?: boolean; goodUp?: boolean; pctOf?: number } = {}): string {
  const shown = o.neg ? -cur : cur;
  return `<tr class="${o.cls ?? ""} ${o.sub ? "sub-line" : ""}">
    <th scope="row">${label}</th>
    <td class="num">${signed(shown)}${o.pctOf ? `<small>${pct((cur / o.pctOf) * 100)}</small>` : ""}</td>
    ${prev === null ? "" : `<td class="num muted">${signed(o.neg ? -prev : prev)}</td><td class="num">${chip(changePct(cur, prev), o.goodUp ?? true)}</td>`}
  </tr>`;
}

function trendChart(): string {
  const data = monthlyTrend();
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const minProfit = Math.min(0, ...data.map((d) => d.profit));
  const W = 640, H = 220, pad = 28, base = H - pad - (minProfit < 0 ? (-minProfit / max) * (H - pad * 2) : 0);
  const scale = (H - pad * 2) / (max - minProfit);
  const bw = (W - pad * 2) / data.length;
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("Net revenue and net profit by month")}">
    <line x1="${pad}" x2="${W - pad}" y1="${base}" y2="${base}" class="axis"/>
    ${data.map((d, i) => {
      const x = pad + i * bw + bw * 0.18;
      const w = bw * 0.3;
      const rh = d.revenue * scale;
      const ph = Math.abs(d.profit) * scale;
      return `<g class="${d.partial ? "partial" : ""}">
        <rect x="${x}" y="${base - rh}" width="${w}" height="${rh}" rx="3" class="rev"><title>${esc(monthLabel(d.month))}: ${money(d.revenue, 0)}</title></rect>
        <rect x="${x + w + 3}" y="${d.profit >= 0 ? base - ph : base}" width="${w}" height="${ph}" rx="3" class="${d.profit >= 0 ? "prof" : "loss"}"><title>${esc(monthLabel(d.month))}: ${signed(d.profit)}</title></rect>
        <text x="${x + w}" y="${H - 8}" text-anchor="middle">${esc(monthLabel(d.month).split(" ")[0])}${d.partial ? "*" : ""}</text>
      </g>`;
    }).join("")}
  </svg>
  <div class="legend"><span><i class="sw rev"></i>${t("Net revenue")}</span><span><i class="sw prof"></i>${t("Net profit")}</span><span class="meta">* ${t("month to date")}</span></div>`;
}

function statement(p: Pnl, q: Pnl | null): string {
  const rev = p.netRevenue;
  return `<div class="table-wrap"><table class="data statement">
    <caption class="sr">${t("Profit and loss statement")}</caption>
    <thead><tr><th scope="col"></th><th scope="col" class="num">${t("This period")}</th>${q ? `<th scope="col" class="num">${t("Previous")}</th><th scope="col" class="num">${t("Change")}</th>` : ""}</tr></thead>
    <tbody>
      ${line(t("Gross sales (incl. VAT)"), p.grossSales, q?.grossSales ?? null, { sub: true })}
      ${line(t("Output VAT 15%"), p.outputVat, q?.outputVat ?? null, { neg: true, sub: true, goodUp: false })}
      ${line(t("Net revenue"), rev, q?.netRevenue ?? null, { cls: "total" })}
      ${line(t("Food"), p.food, q?.food ?? null, { sub: true, pctOf: rev })}
      ${line(t("Beverages"), p.beverage, q?.beverage ?? null, { sub: true, pctOf: rev })}
      <tr class="group"><th scope="rowgroup" colspan="${q ? 4 : 2}">${t("Cost of goods sold")}</th></tr>
      ${COGS_IDS.map((c) => line(esc(tk(`cogs.${c}`)), p.cogs[c], q?.cogs[c] ?? null, { neg: true, sub: true, goodUp: false, pctOf: rev })).join("")}
      ${line(t("Total COGS"), p.totalCogs, q?.totalCogs ?? null, { neg: true, cls: "total", goodUp: false, pctOf: rev })}
      ${line(t("Gross profit"), p.grossProfit, q?.grossProfit ?? null, { cls: "total strong", pctOf: rev })}
      <tr class="group"><th scope="rowgroup" colspan="${q ? 4 : 2}">${t("Operating expenses")}</th></tr>
      ${OPEX_IDS.map((c) => line(`${esc(tk(`opex.${c}`))}${(c === "PAYROLL" && p.payrollAccrued) || (c === "RENT" && p.rentAccrued) ? ` <small class="meta">${t("(accrued)")}</small>` : ""}`, p.opex[c], q?.opex[c] ?? null, { neg: true, sub: true, goodUp: false, pctOf: rev })).join("")}
      ${line(t("Total operating expenses"), p.totalOpex, q?.totalOpex ?? null, { neg: true, cls: "total", goodUp: false, pctOf: rev })}
      ${line(t("Operating profit"), p.operatingProfit, q?.operatingProfit ?? null, { cls: "total strong", pctOf: rev })}
      ${line(t("Business income tax {p}% (estimate)", { p: PROFIT_TAX_RATE * 100 }), p.profitTax, q?.profitTax ?? null, { neg: true, sub: true, goodUp: false })}
      ${line(t("Net profit"), p.netProfit, q?.netProfit ?? null, { cls: "grand", pctOf: rev })}
    </tbody></table></div>`;
}

export function renderPnl(): string {
  const r = periodRange();
  const p = pnl(r.from, r.to);
  const q = r.prev[0] ? pnl(r.prev[0], r.prev[1]) : null;
  const rev = p.netRevenue || 1;
  const prime = p.totalCogs + p.opex.PAYROLL;
  const parts: [string, number, string][] = [
    [t("Cost of goods sold"), p.totalCogs, COLORS[3]], [t("Salaries & pension"), p.opex.PAYROLL, COLORS[1]], [t("Rent"), p.opex.RENT, COLORS[2]],
    [t("Other operating costs"), p.totalOpex - p.opex.PAYROLL - p.opex.RENT, COLORS[5]], [t("Net profit"), p.netProfit, COLORS[0]],
  ];
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Profit & loss")}</h1>
      <p>${esc(dayLabel(r.from))} – ${esc(dayLabel(r.to))}${q ? ` · ${t("compared with {a} – {b}", { a: dayLabel(r.prev[0]), b: dayLabel(r.prev[1]) })}` : ""}</p></div>
      <div class="head-controls">${seg("period", state.period, PERIODS.map(([v, l]) => [v, t(l)] as const), t("Period"), "small")}</div></div>
    <section class="metrics"><h2 class="sr">${t("Summary")}</h2><div class="metric-grid">
      ${metricCard({ icon: "sale", title: t("Net revenue"), value: money(p.netRevenue, 0), note: t("excl. VAT"), change: q ? chip(changePct(p.netRevenue, q.netRevenue), true) : "" })}
      ${metricCard({ icon: "box", title: t("Total COGS"), value: money(p.totalCogs, 0), note: t("{p} food & beverage cost", { p: pct((p.totalCogs / rev) * 100) }), change: q ? chip(changePct(p.totalCogs, q.totalCogs), false) : "" })}
      ${metricCard({ icon: "receipt", title: t("Operating expenses"), value: money(p.totalOpex, 0), note: t("{p} of revenue", { p: pct((p.totalOpex / rev) * 100) }), change: q ? chip(changePct(p.totalOpex, q.totalOpex), false) : "" })}
      ${metricCard({ icon: "wallet", title: t("Net profit"), value: signed(p.netProfit), tone: p.netProfit >= 0 ? "good" : "bad", note: t("{p} net margin", { p: pct((p.netProfit / rev) * 100) }), change: q ? chip(changePct(p.netProfit, q.netProfit), true) : "" })}
    </div></section>
    <div class="pnl-layout">
      <section class="card" aria-labelledby="stTitle">
        <div class="card-head"><div><h2 id="stTitle">${t("Statement")}</h2><p>${t("Accrual basis: costs by bill date, VAT excluded where it can be claimed back.")}</p></div></div>
        ${statement(p, q)}
      </section>
      <div class="side">
        <section class="card" aria-labelledby="trTitle"><div class="card-head"><div><h2 id="trTitle">${t("Six-month trend")}</h2></div></div>${trendChart()}</section>
        <section class="card" aria-labelledby="csTitle">
          <div class="card-head"><div><h2 id="csTitle">${t("Where each birr goes")}</h2><p>${t("Share of net revenue")}</p></div></div>
          <div class="stack" aria-hidden="true">${parts.filter(([, v]) => v > 0).map(([, v, c]) => `<i style="flex:${v};background:${c}"></i>`).join("")}</div>
          <div class="bar-list">${parts.map(([l, v, c]) => bar(`${l}`, v, rev, c, pct((v / rev) * 100))).join("")}</div>
          <p class="kpi">${t("Prime cost (COGS + payroll)")}: <strong class="${prime / rev > 0.65 ? "bad-text" : prime / rev > 0.6 ? "warn-text" : "good-text"}">${pct((prime / rev) * 100)}</strong>
            <small class="meta">${t("Restaurants usually aim for 60–65% or less.")}</small></p>
        </section>
      </div>
    </div>`;
}

export const pnlActions: ActionMap = {
  period: (el) => {
    const v = el.dataset.value;
    if (v !== "this" && v !== "last" && v !== "q" && v !== "fy") return;
    state.period = v;
    rerender(`[data-action="period"][data-value="${v}"]`);
  },
};
