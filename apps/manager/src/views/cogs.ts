/* Direct material & inventory costs (COGS) supervision.
   Purchases entered by the inventory clerk, grouped into the five COGS
   categories. The manager approves (stock goes up) or flags with a
   reason. Kept fully separate from sales. */

import type { COGSCategory, ReviewStatus } from "../types";
import { t, tk } from "../i18n";
import { fmtDay, fmtTime, localDay, money } from "../format";
import { COGS_COLOR, COGS_IDS, isCogs } from "../catalog";
import { approvePurchase, db, inPeriod, item, reopenPurchase, state, user } from "../store";
import { esc, icon } from "../ui/dom";
import { dot, empty, periodSeg, qtyUnit, seg, stampOf, staffCell, statusPill } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "./modals";
import { lowStockWidget } from "./overview";

/** Include pending purchases whatever their date, so nothing waiting is hidden by the period filter. */
const visible = (p: { timestamp: string; status: ReviewStatus }): boolean => p.status === "PENDING" || inPeriod(p.timestamp);

function categoryCards(): string {
  const tot = new Map<COGSCategory, { sum: number; n: number; pending: number }>();
  for (const c of COGS_IDS) tot.set(c, { sum: 0, n: 0, pending: 0 });
  for (const p of db.purchases) {
    if (!visible(p)) continue;
    const e = tot.get(p.category);
    if (!e) continue;
    if (p.status !== "FLAGGED") e.sum += p.totalCost;
    e.n++;
    if (p.status === "PENDING") e.pending++;
  }
  return `<div class="cat-grid" role="group" aria-label="${t("COGS category")}">
    <button type="button" class="cat-card" data-action="cogs-cat" data-value="ALL" aria-pressed="${state.cogsCat === "ALL"}">
      <span class="cat-name">${t("All categories")}</span>
      <strong class="num">${money([...tot.values()].reduce((s, e) => s + e.sum, 0), 0)}</strong>
      <small>${t("Records: {n}", { n: [...tot.values()].reduce((s, e) => s + e.n, 0) })}</small></button>
    ${COGS_IDS.map((c) => {
      const e = tot.get(c) ?? { sum: 0, n: 0, pending: 0 };
      return `<button type="button" class="cat-card" data-action="cogs-cat" data-value="${c}" aria-pressed="${state.cogsCat === c}" style="--cat:${COGS_COLOR[c]}">
        <span class="cat-name">${dot(COGS_COLOR[c])}${esc(tk(`cogs.${c}`))}</span>
        <strong class="num">${money(e.sum, 0)}</strong>
        <small>${t("Records: {n}", { n: e.n })}${e.pending ? ` · <span class="warn-text">${t("{n} to review", { n: e.pending })}</span>` : ""}</small></button>`;
    }).join("")}
  </div>`;
}

function table(): string {
  const list = db.purchases
    .filter((p) => visible(p) && (state.cogsCat === "ALL" || p.category === state.cogsCat) && (state.cogsStatus === "ALL" || p.status === state.cogsStatus))
    .sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 80);
  if (!list.length) return empty(t("No purchase records match"));
  return `<div class="table-wrap"><table class="data cogs-table">
    <caption class="sr">${t("Purchase records")}</caption>
    <thead><tr><th scope="col">${t("Item")}</th><th scope="col">${t("Category")}</th><th scope="col" class="num">${t("Quantity")}</th>
      <th scope="col" class="num">${t("Unit cost")}</th><th scope="col" class="num">${t("Total")}</th><th scope="col">${t("Vendor · paid with")}</th>
      <th scope="col">${t("Logged by")}</th><th scope="col">${t("Review")}</th></tr></thead>
    <tbody>${list.map((p) => {
      const it = item(p.itemId);
      return `<tr class="${p.status === "PENDING" ? "pending-row" : ""}">
        <th scope="row">${esc(it ? tk(it.nameKey) : p.itemId)}<small class="sub">${esc(it ? tk(it.groupKey) : "")}</small></th>
        <td>${dot(COGS_COLOR[p.category])}<span class="cat-short">${esc(tk(`cogs.${p.category}`))}</span></td>
        <td class="num">${qtyUnit(p.quantity, p.unit)}</td>
        <td class="num">${money(p.unitCost, 2)}</td>
        <td class="num strong">${money(p.totalCost, 0)}</td>
        <td>${esc(p.vendor)}<small class="sub">${esc(tk(`pay.${p.paymentMethod}`))}</small></td>
        <td>${staffCell(p.loggedBy)}<small class="sub">${esc(fmtDay(localDay(p.timestamp)))} ${fmtTime(p.timestamp)}</small></td>
        <td class="review-cell">${p.status === "PENDING"
          ? `<div class="row-actions"><button type="button" class="btn small approve" data-action="approve-purchase" data-value="${p.id}">${icon("check")} ${t("Approve")}</button>
             <button type="button" class="btn small ghost" data-action="flag-purchase" data-value="${p.id}">${icon("flag")} ${t("Flag")}</button></div>`
          : `${statusPill(p.status)}${p.flagReason ? `<small class="why">${esc(t(p.flagReason))}</small>` : ""}${p.reviewedBy && p.reviewedAt ? `<div>${stampOf(p.reviewedBy, p.reviewedAt)}</div>` : ""}
             ${p.status === "FLAGGED" ? `<button type="button" class="btn small ghost" data-action="approve-purchase" data-value="${p.id}">${t("Approve anyway")}</button>` : ""}`}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

export function renderCogs(): string {
  const pending = db.purchases.filter((p) => p.status === "PENDING").length;
  return `
    <div class="page-head"><div><h1>${t("Purchases (COGS)")}</h1>
      <p>${t("Direct material and inventory costs entered by the inventory clerk. Approving confirms delivery and adds the stock.")}</p></div>
      <div class="head-controls">${periodSeg()}</div></div>
    ${lowStockWidget(6)}
    ${categoryCards()}
    <section class="card" aria-labelledby="recTitle">
      <div class="card-head"><div><h2 id="recTitle">${t("Purchase records")}</h2><p>${t("{n} waiting for review", { n: pending })}</p></div>
        ${seg("cogs-status", state.cogsStatus, [["ALL", t("All")], ["PENDING", t("Pending")], ["APPROVED", t("Approved")], ["FLAGGED", t("Flagged")]], t("Status"), "small")}</div>
      ${table()}
    </section>`;
}

export const cogsActions: ActionMap = {
  "cogs-cat": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.cogsCat = v === "ALL" || isCogs(v) ? v : "ALL";
    rerender(`[data-action="cogs-cat"][data-value="${state.cogsCat}"]`);
  },
  "cogs-status": (el) => {
    const v = el.dataset.value;
    state.cogsStatus = v === "PENDING" || v === "APPROVED" || v === "FLAGGED" ? v : "ALL";
    rerender(`[data-action="cogs-status"][data-value="${state.cogsStatus}"]`);
  },
  "approve-purchase": (el) => {
    const id = el.dataset.value ?? "";
    const p = db.purchases.find((x) => x.id === id);
    const it = p ? item(p.itemId) : undefined;
    if (!p || !it || !approvePurchase(id)) return;
    rerender();
    toast(t("Approved {item} · {q} · {x} · by {name}", { item: tk(it.nameKey), q: qtyUnit(p.quantity, p.unit), x: money(p.totalCost, 0), name: user().name }),
      () => { reopenPurchase(id, true); rerender(); });
  },
  "flag-purchase": (el) => openModal({ kind: "flag", id: el.dataset.value ?? "" }, el),
};
