/* Overview: three live metric cards, the low-stock warning widget,
   today's payment split (Cash / Telebirr / CBE Birr) by shift, COGS
   today and the latest accountable activity. Dispatch decisions are
   made only on the Dispatch page; this page links there. */

import type { PaymentMethod, PaymentSummary } from "../types";
import { t, tk } from "../i18n";
import { fmtTime, money, num, pct } from "../format";
import { COGS_COLOR, COGS_IDS, PAY_COLOR, PAY_IDS } from "../catalog";
import { db, inPeriod, lowStock, paymentSummary, pendingDispatches, periodTotals, state, stockLevel, suggestedOrder, user } from "../store";
import { esc, icon } from "../ui/dom";
import { bar, changePct, chip, compareLabel, dot, empty, metricCard, payName, qtyUnit, shiftSeg } from "../ui/shared";
import { auditLine } from "./audit";

const SUMMARY_KEY: Record<PaymentMethod, keyof PaymentSummary> = { CASH: "cash", TELEBIRR: "telebirr", CBE_BIRR: "cbeBirr" };

export function metricCards(): string {
  const { cur, prev } = periodTotals("today");
  const pending = pendingDispatches();
  const oldest = pending[0];
  return `<section class="metrics" aria-labelledby="metricsTitle"><h2 class="sr" id="metricsTitle">${t("Today at a glance")}</h2>
    <div class="metric-grid three">
      ${metricCard({ cls: "m-sales", icon: "sale", title: t("Today's Total Sales"), value: money(cur.sales, 0),
        change: chip(changePct(cur.sales, prev.sales), true), foot: compareLabel("today"), note: t("{n} tickets", { n: cur.tickets }), action: "sales" })}
      ${metricCard({ cls: "m-dispatch", icon: "truck", title: t("Pending Dispatches"), value: String(pending.length),
        change: pending.length ? `<span class="chip warn">${t("Needs review")}</span>` : `<span class="chip good">${t("All clear")}</span>`,
        foot: oldest ? t("oldest sent {time}", { time: fmtTime(oldest.timestamp) }) : "", note: t("Review on the Dispatch page"), action: "dispatch" })}
      ${metricCard({ cls: "m-waste", icon: "trash", title: t("Total Spoilage/Loss Value"), value: money(cur.waste, 0),
        change: chip(changePct(cur.waste, prev.waste), false), foot: compareLabel("today"),
        note: cur.sales ? t("{p} of today's sales", { p: pct((cur.waste / cur.sales) * 100) }) : "", action: "waste" })}
    </div></section>`;
}

/** Strictly three local channels: Cash, Telebirr, CBE Birr. */
export function paymentPanel(period: "today" | "7d" | "30d", withHead = true): string {
  const sum = paymentSummary(period, state.shift);
  return `
    ${withHead ? `<div class="card-head"><div><h2 id="payTitle">${t("Payment reconciliation")}</h2><p>${t("Cash, Telebirr and CBE Birr")}</p></div>${shiftSeg()}</div>` : ""}
    <div class="pay-cards">${PAY_IDS.map((m) => {
      const v = sum[SUMMARY_KEY[m]];
      return `<div class="pay-card" style="--pay:${PAY_COLOR[m]}"><span>${dot(PAY_COLOR[m])}${esc(payName(m))}</span><strong class="num">${money(v, 0)}</strong>
        <small>${sum.total ? pct((v / sum.total) * 100, 0) : "0%"}</small></div>`;
    }).join("")}</div>
    <div class="pay-split" aria-hidden="true">${PAY_IDS.map((m) => `<i style="flex:${sum[SUMMARY_KEY[m]] || 0};background:${PAY_COLOR[m]}"></i>`).join("")}</div>
    <div class="pay-total"><span>${t("Total")}</span><strong class="num">${money(sum.total, 0)}</strong></div>`;
}

const LEVEL_LABEL = { OUT: "Out of stock", CRITICAL: "Critical", LOW: "Low" } as const;

/** Low-stock warning widget. Rule: currentQuantity <= reorderPoint. Rebuilt on every render from live stock. */
export function lowStockWidget(limit = 8): string {
  const low = lowStock();
  if (!low.length) {
    return `<section class="card stock-ok" aria-labelledby="lowTitle"><div class="card-head"><div><h2 id="lowTitle">${icon("check")} ${t("Stock levels OK")}</h2>
      <p>${t("Every item is above its reorder point.")}</p></div></div></section>`;
  }
  const out = low.filter((i) => stockLevel(i) === "OUT").length;
  const critical = low.filter((i) => stockLevel(i) === "CRITICAL").length;
  return `<section class="card low-widget" id="lowStock" role="region" aria-labelledby="lowTitle">
    <div class="card-head"><div><h2 id="lowTitle">${icon("alert")} ${t("Low stock warning")}</h2>
      <p>${t("{n} items at or below their reorder point", { n: low.length })}${out ? ` · <strong class="bad-text">${t("{n} out of stock", { n: out })}</strong>` : ""}${
        critical ? ` · ${t("{n} critical", { n: critical })}` : ""}</p></div>
      <a class="btn small" href="#cogs">${t("Restock")} ${icon("arrow")}</a></div>
    <ul class="low-grid">${low.slice(0, limit).map((i) => {
      const lvl = stockLevel(i);
      const fill = Math.min(100, (i.currentQuantity / Math.max(i.reorderPoint, 1)) * 100);
      return `<li class="low-item lvl-${lvl.toLowerCase()} row-hover">
        <div class="low-top"><strong>${esc(tk(i.nameKey))}</strong><span class="lvl-tag">${t(LEVEL_LABEL[lvl as keyof typeof LEVEL_LABEL])}</span></div>
        <div class="low-qty"><span class="num">${qtyUnit(i.currentQuantity, i.unit)}</span><small>/ ${t("reorder at {x}", { x: num(i.reorderPoint) })}</small></div>
        <span class="low-track" aria-hidden="true"><i style="width:${fill}%"></i></span>
        <small class="low-sugg">${t("Order about {x}", { x: qtyUnit(suggestedOrder(i), i.unit) })}</small>
      </li>`;
    }).join("")}</ul>
    ${low.length > limit ? `<p class="meta more-low">${t("+{n} more items low", { n: low.length - limit })}</p>` : ""}
  </section>`;
}

export function renderOverview(): string {
  const byCat = new Map<string, number>();
  let cogsTotal = 0;
  for (const p of db.purchases) {
    if (p.status === "FLAGGED" || !inPeriod(p.timestamp, "today")) continue;
    byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.totalCost);
    cogsTotal += p.totalCost;
  }
  const catMax = Math.max(0, ...byCat.values());
  const toReview = db.purchases.filter((p) => p.status === "PENDING").length;
  const pending = pendingDispatches().length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Good day, {name}", { name: esc(user().name.split(" ")[0]) })}</h1>
      <p>${esc(tk("branch.name"))} · ${t("Live view of today's sales, costs and approvals.")}</p></div></div>
    ${metricCards()}
    ${pending ? `<a class="dispatch-banner" href="#dispatch">${icon("truck")}<span><strong>${t("{n} dispatches waiting for your decision", { n: pending })}</strong>
      <small>${t("Approve or reject them on the Dispatch page.")}</small></span>${icon("arrow")}</a>` : ""}
    ${lowStockWidget()}
    <div class="grid-2">
      <section class="card" aria-labelledby="payTitle">${paymentPanel("today")}</section>
      <section class="card" aria-labelledby="cogsTitle">
        <div class="card-head"><div><h2 id="cogsTitle">${t("COGS purchases today")}</h2><p>${money(cogsTotal, 0)} · ${t("{n} to review", { n: toReview })}</p></div>
          <a class="btn small" href="#cogs">${t("Review")} ${icon("arrow")}</a></div>
        ${catMax ? `<div class="bar-list">${COGS_IDS.filter((c) => byCat.get(c)).map((c) => bar(`${dot(COGS_COLOR[c])}${esc(tk(`cogs.${c}`))}`, byCat.get(c) ?? 0, catMax, COGS_COLOR[c])).join("")}</div>`
          : empty(t("No purchases today yet"))}
      </section>
    </div>
    <section class="card" aria-labelledby="actTitle">
      <div class="card-head"><div><h2 id="actTitle">${t("Latest activity")}</h2><p>${t("Who did what, and when")}</p></div>
        <a class="btn small" href="#audit">${t("Audit trail")} ${icon("arrow")}</a></div>
      <ul class="activity">${db.audit.slice(0, 6).map(auditLine).join("")}</ul>
    </section>`;
}
