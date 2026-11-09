/* Dashboard (buying only): spending cards, purchases by main category
   and by COGS category, waste by reason, and the latest activity. */

import type { COGSCategory, MainCategory, WasteReason } from "../types";
import { t, tk } from "../i18n";
import { money, pct } from "../format";
import { COGS_COLOR, COGS_IDS, MAIN_COLOR, MAIN_IDS, WASTE_IDS } from "../catalog";
import { canView, db, inPeriod, inventoryItem, periodTotals, state, user } from "../store";
import { esc, icon } from "../ui/dom";
import { byline, metricsBar, periodSeg, roleName } from "../ui/shared";
import { auditLine } from "./audit";

export function renderDashboard(): string {
  const u = user();
  const { cur } = periodTotals();

  // purchases by main category
  const byMain = new Map<MainCategory, number>();
  for (const p of db.purchases) {
    if (!inPeriod(p.timestamp)) continue;
    const main = inventoryItem(p.itemId)?.main;
    if (main) byMain.set(main, (byMain.get(main) ?? 0) + p.totalCost);
  }
  const mainMax = Math.max(0, ...byMain.values());

  // purchases by category
  const byCat = new Map<COGSCategory, number>();
  for (const p of db.purchases) if (inPeriod(p.timestamp)) byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.totalCost);
  const catTotal = [...byCat.values()].reduce((a, b) => a + b, 0);

  // waste by reason
  const byReason = new Map<WasteReason, number>();
  for (const w of db.waste) if (inPeriod(w.timestamp) && w.approval !== "REJECTED") byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + w.lossValue);
  const wasteTotal = [...byReason.values()].reduce((a, b) => a + b, 0);
  const pending = db.waste.filter((w) => w.approval === "PENDING");

  const bar = (label: string, value: number, max: number, color: string, extra = ""): string => `
    <div class="bar-row static"><span>${label}</span><span class="num">${money(value, 0)}${extra}</span>
      <span class="bar-track"><i style="width:${max ? (value / max) * 100 : 0}%;background:${color}"></i></span></div>`;

  return `
    <div class="page-head">
      <div><h1>${t("Dashboard")}</h1><p>${t("Hello {name}. Here is what the restaurant bought.", { name: esc(u.name.split(" ")[0]) })}</p></div>
      ${periodSeg()}
    </div>
    ${metricsBar()}
    ${pending.length && canView("audit") ? `
      <div class="attention" role="status">${icon("alert")}
        <p><strong>${t("{n} waste reports need your approval", { n: pending.length })}</strong> · ${t("{x} in losses waiting for review.", { x: money(pending.reduce((s, w) => s + w.lossValue, 0), 0) })}</p>
        <a class="btn small" href="#waste" data-action="show-pending">${t("Review")} ${icon("arrow")}</a>
      </div>` : ""}
    <div class="grid-3">
      <section class="card" aria-labelledby="mainTitle">
        <div class="card-head"><div><h2 id="mainTitle">${t("What we bought")}</h2><p>${t("{n} entries", { n: cur.entries })}</p></div>
          ${canView("purchases") ? `<a class="btn small" href="#purchases">${t("Purchases")} ${icon("arrow")}</a>` : ""}</div>
        ${mainMax ? `<div class="bar-list">${MAIN_IDS.filter((m) => byMain.get(m)).sort((a, b) => (byMain.get(b) ?? 0) - (byMain.get(a) ?? 0)).map((m) =>
          bar(`<i class="dot" style="background:${MAIN_COLOR[m]}"></i>${esc(tk(`main.${m}`))}`, byMain.get(m) ?? 0, mainMax, MAIN_COLOR[m])).join("")}</div>`
          : `<div class="empty"><strong>${t("No purchases in this period")}</strong></div>`}
      </section>
      <section class="card" aria-labelledby="cogsTitle">
        <div class="card-head"><div><h2 id="cogsTitle">${t("Purchases by category")}</h2><p>${money(catTotal, 0)}</p></div></div>
        ${catTotal ? `<div class="bar-list">${COGS_IDS.filter((c) => byCat.get(c)).map((c) =>
          bar(`<i class="dot" style="background:${COGS_COLOR[c]}"></i>${esc(tk(`cogs.${c}`))}`, byCat.get(c) ?? 0, catTotal, COGS_COLOR[c])).join("")}</div>`
          : `<div class="empty"><strong>${t("No purchases in this period")}</strong></div>`}
      </section>
      <section class="card" aria-labelledby="wasteTitle">
        <div class="card-head"><div><h2 id="wasteTitle">${t("Waste by reason")}</h2><p>${t("{x} · {p} of purchases", { x: money(wasteTotal, 0), p: pct(cur.purchases ? (wasteTotal / cur.purchases) * 100 : 0) })}</p></div></div>
        ${wasteTotal ? `<div class="bar-list">${WASTE_IDS.filter((r) => byReason.get(r)).sort((a, b) => (byReason.get(b) ?? 0) - (byReason.get(a) ?? 0)).map((r) =>
          bar(esc(tk(`waste.${r}`)), byReason.get(r) ?? 0, wasteTotal, "var(--spend)")).join("")}</div>`
          : `<div class="empty"><strong>${t("No waste reported in this period")}</strong></div>`}
      </section>
    </div>
    <section class="card" aria-labelledby="actTitle">
      <div class="card-head"><div><h2 id="actTitle">${t("Latest activity")}</h2><p>${t("Signed in as {name} ({role})", { name: esc(u.name), role: esc(roleName(u.role)) })}</p></div>
        ${canView("audit") ? `<a class="btn small" href="#audit">${t("Full audit trail")} ${icon("arrow")}</a>` : ""}</div>
      <ul class="activity">${db.audit.filter((a) => canView("audit") || a.userId === u.userId).slice(0, 8).map(auditLine).join("") ||
        `<li class="empty"><strong>${t("No activity yet")}</strong></li>`}</ul>
    </section>
    <p class="meta fine">${byline(u.name, new Date().toISOString())}</p>`;
}

export function dashboardPeriodChanged(): void {
  state.view = "dashboard";
}
