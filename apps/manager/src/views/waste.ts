/* Waste & shrinkage audit: loss value by reason for the period, and every
   log with the reporting staff ID and who entered it. New logs are
   recorded in a modal ("Log waste"). Logging takes the quantity out of stock. */

import { t, tk } from "../i18n";
import { money, pct } from "../format";
import { WASTE_COLOR, WASTE_IDS, isWasteReason } from "../catalog";
import { db, decideWasteReport, inPeriod, item, periodTotals, reopenWasteReport, state, user } from "../store";
import { toast } from "../ui/toast";
import { esc, icon } from "../ui/dom";
import { bar, dot, empty, periodSeg, qtyUnit, seg, stampOf, staffCell } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "./modals";

/** Live mode: waste the inventory clerk reported, waiting for the manager. Approving takes it out of stock. */
function renderPending(): string {
  const pending = db.waste.filter((w) => w.pending).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  if (!pending.length) return "";
  return `
    <section class="card" aria-labelledby="wpTitle">
      <div class="card-head"><div><h2 id="wpTitle">${t("Waiting for your approval")}</h2>
        <p>${t("Approving takes the quantity out of stock and counts it as a loss.")}</p></div></div>
      <div class="table-wrap"><table class="data">
        <caption class="sr">${t("Waiting for your approval")}</caption>
        <thead><tr><th scope="col">${t("Item")}</th><th scope="col" class="num">${t("Quantity Lost")}</th><th scope="col" class="num">${t("Loss value")}</th>
          <th scope="col">${t("Reason")}</th><th scope="col">${t("Notes")}</th><th scope="col">${t("Logged by")}</th><th scope="col"><span class="sr">${t("Decision")}</span></th></tr></thead>
        <tbody>${pending.map((w) => `<tr>
          <th scope="row">${esc(tk(w.itemName))}</th><td class="num">${qtyUnit(w.quantityLost, w.unit)}</td><td class="num strong">${money(w.lossValue, 0)}</td>
          <td>${dot(WASTE_COLOR[w.reason])}${esc(tk(`waste.${w.reason}`))}</td>
          <td class="notes">${w.customNotes ? esc(w.customNotes) : "—"}</td>
          <td>${stampOf(w.loggedBy, w.timestamp)}</td>
          <td class="actions"><div class="row-actions">
            <button type="button" class="btn small primary" data-action="waste-approve" data-value="${w.id}">${icon("check")} ${t("Approve")}</button>
            <button type="button" class="btn small" data-action="waste-reject" data-value="${w.id}">${t("Reject")}</button>
          </div></td>
        </tr>`).join("")}</tbody></table></div>
    </section>`;
}

export function renderWaste(): string {
  const all = db.waste.filter((w) => !w.pending && inPeriod(w.timestamp));
  const byReason = new Map<string, number>();
  for (const w of all) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + w.lossValue);
  const max = Math.max(0, ...byReason.values());
  const total = all.reduce((s, w) => s + w.lossValue, 0);
  const { cur } = periodTotals();
  const list = all.filter((w) => state.wasteReason === "ALL" || w.reason === state.wasteReason).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const present = WASTE_IDS.filter((r) => byReason.get(r));
  return `
    <div class="page-head"><div><h1>${t("Waste & shrinkage")}</h1><p>${t("Physical losses with the reason and the staff member who reported them.")}</p></div>
      <div class="head-controls">${periodSeg()}<button type="button" class="btn primary" data-action="open-waste">${icon("plus")} ${t("Log waste")}</button></div></div>
    <div class="grid-2 waste-top">
      <section class="card" aria-labelledby="wrTitle">
        <div class="card-head"><div><h2 id="wrTitle">${t("Loss by reason")}</h2>
          <p>${money(total, 0)}${cur.sales ? ` · ${t("{p} of sales", { p: pct((total / cur.sales) * 100) })}` : ""}</p></div></div>
        ${max ? `<div class="bar-list">${present.sort((a, b) => (byReason.get(b) ?? 0) - (byReason.get(a) ?? 0)).map((r) =>
          bar(`${dot(WASTE_COLOR[r])}${esc(tk(`waste.${r}`))}`, byReason.get(r) ?? 0, max, WASTE_COLOR[r])).join("")}</div>` : empty(t("No waste logged in this period"))}
      </section>
      <section class="card" aria-labelledby="wsTitle">
        <div class="card-head"><div><h2 id="wsTitle">${t("Logs in this period")}</h2><p>${t("{n} logs", { n: all.length })}</p></div></div>
        <div class="stat-row tight">
          <div class="stat"><span>${t("Loss value")}</span><strong class="num">${money(total, 0)}</strong></div>
          <div class="stat"><span>${t("Inventory theft")}</span><strong class="num ${byReason.get("INVENTORY_THEFT") ? "bad-text" : ""}">${money(byReason.get("INVENTORY_THEFT") ?? 0, 0)}</strong></div>
          <div class="stat"><span>${t("Spoilage & expired")}</span><strong class="num">${money((byReason.get("SPOILAGE") ?? 0) + (byReason.get("EXPIRED_STOCK") ?? 0), 0)}</strong></div>
        </div>
      </section>
    </div>
    ${renderPending()}
    <section class="card" aria-labelledby="wlTitle">
      <div class="card-head"><div><h2 id="wlTitle">${t("Waste log")}</h2></div>
        ${seg("waste-reason", state.wasteReason, [["ALL", t("All")], ...present.map((r) => [r, tk(`waste.${r}`)] as const)], t("Reason"), "small wrap")}</div>
      ${list.length ? `<div class="table-wrap"><table class="data">
        <caption class="sr">${t("Waste log")}</caption>
        <thead><tr><th scope="col">${t("Item")}</th><th scope="col" class="num">${t("Quantity Lost")}</th><th scope="col" class="num">${t("Loss value")}</th>
          <th scope="col">${t("Reason")}</th><th scope="col">${t("Notes")}</th><th scope="col">${t("Reporting Staff ID")}</th><th scope="col">${t("Logged by")}</th></tr></thead>
        <tbody>${list.slice(0, 60).map((w) => `<tr>
          <th scope="row">${esc(tk(w.itemName))}</th><td class="num">${qtyUnit(w.quantityLost, w.unit)}</td><td class="num strong">${money(w.lossValue, 0)}</td>
          <td>${dot(WASTE_COLOR[w.reason])}${esc(tk(`waste.${w.reason}`))}</td>
          <td class="notes">${w.customNotes ? esc(w.customNotes) : "—"}</td>
          <td>${staffCell(w.reportedBy)}</td>
          <td>${stampOf(w.loggedBy, w.timestamp)}</td>
        </tr>`).join("")}</tbody></table></div>` : empty(t("No waste logged in this period"))}
    </section>`;
}

export const wasteActions: ActionMap = {
  "open-waste": (el) => openModal({ kind: "waste" }, el),
  "waste-approve": (el) => decide(el.dataset.value ?? "", true),
  "waste-reject": (el) => decide(el.dataset.value ?? "", false),
  "waste-reason": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.wasteReason = v === "ALL" || isWasteReason(v) ? v : "ALL";
    rerender(`[data-action="waste-reason"][data-value="${state.wasteReason}"]`);
  },
};

function decide(id: string, approve: boolean): void {
  const rec = decideWasteReport(id, approve);
  if (!rec) return;
  rerender();
  const name = tk(item(rec.itemId)?.nameKey ?? rec.itemName);
  toast(t(approve ? "Approved waste: {item} · by {name}" : "Rejected waste: {item} · by {name}", { item: name, name: user().name }),
    () => { reopenWasteReport(rec, approve); rerender(); });
}
