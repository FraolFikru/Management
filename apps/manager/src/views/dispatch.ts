/* Dispatch page — the ONE place where sales dispatches are managed.
   Top: today's dispatch summary. Then the pending queue (oldest first):
   each request shows item, requested quantity, destination, time, the
   sales staff ID, and what approval does to stock (before → after, and
   whether it would drop to low stock). Approve updates inventory at once;
   Reject needs a reason. Below: the decision history on the same page. */

import type { DispatchRecord } from "../types";
import { t, tk } from "../i18n";
import { fmtDay, fmtTime, localDay, today } from "../format";
import { db, approveDispatch, isLowStock, item, pendingDispatches, reopenDispatch, state, stockLevel, user } from "../store";
import { esc, icon } from "../ui/dom";
import { empty, qtyUnit, seg, stampOf, staffCell, statusPill } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { openModal } from "./modals";

let historyLimit = 12;

const ago = (iso: string): number => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

/** One pending request with everything needed to decide. */
function requestCard(d: DispatchRecord): string {
  const it = item(d.itemId);
  const short = it ? it.currentQuantity < d.quantity : true;
  const after = it ? it.currentQuantity - d.quantity : 0;
  const goesLow = Boolean(it && !short && after <= it.reorderPoint);
  const waited = ago(d.timestamp);
  return `<li class="dispatch row-hover" id="dsp-${d.id}">
    <div class="dsp-col">
      <div class="dsp-main"><strong>${esc(tk(d.itemName))}</strong><span class="dsp-qty num">${qtyUnit(d.quantity, d.unit)}</span></div>
      <span class="dsp-dest">${icon("arrow")} ${esc(tk(`dest.${d.destination}`))}</span>
      ${stampOf(d.requestedBy, d.timestamp, t("Requested by"))}
      <small class="wait ${waited >= 30 ? "late" : ""}">${t("waiting {n} min", { n: waited })}</small>
    </div>
    <div class="dsp-col stock-col">
      <span class="label">${t("Stock impact")}</span>
      ${it ? `<span class="stock-line num ${short ? "short" : ""}">${qtyUnit(it.currentQuantity, it.unit)}${short ? "" : ` → <strong>${qtyUnit(after, it.unit)}</strong>`}</span>
        <small class="meta">${t("reorder at {x}", { x: qtyUnit(it.reorderPoint, it.unit) })}</small>` : "—"}
      ${short ? `<span class="flag bad">${icon("alert")} ${t("Not enough stock to approve.")}</span>`
        : goesLow ? `<span class="flag warn">${icon("alert")} ${t("Approving will put this item at low stock.")}</span>`
        : it && isLowStock(it) ? `<span class="flag warn">${icon("alert")} ${t("Already low stock")}</span>` : ""}
    </div>
    <div class="dsp-actions">
      <button type="button" class="btn approve" data-action="approve-dispatch" data-value="${d.id}" ${short ? "disabled" : ""}>${icon("check")} ${t("Approve Dispatch")}</button>
      <button type="button" class="btn ghost reject" data-action="reject-dispatch" data-value="${d.id}">${icon("x")} ${t("Reject with Reason")}</button>
    </div>
  </li>`;
}

function history(): string {
  const filter = state.dispatchTab;
  const list = db.dispatches
    .filter((d) => d.status !== "PENDING" && (filter === "ALL" || d.status === filter))
    .sort((a, b) => ((a.decidedAt ?? "") < (b.decidedAt ?? "") ? 1 : -1));
  if (!list.length) return empty(t("No decisions yet"));
  const shown = list.slice(0, historyLimit);
  return `<div class="table-wrap"><table class="data">
    <caption class="sr">${t("Decided dispatches")}</caption>
    <thead><tr><th scope="col">${t("Item Name")}</th><th scope="col" class="num">${t("Requested Quantity")}</th><th scope="col">${t("Target/Destination")}</th>
      <th scope="col">${t("Sales Staff ID")}</th><th scope="col">${t("Timestamp")}</th><th scope="col">${t("Status")}</th><th scope="col">${t("Decided by")}</th></tr></thead>
    <tbody>${shown.map((d) => `<tr>
      <th scope="row">${esc(tk(d.itemName))}</th>
      <td class="num">${qtyUnit(d.quantity, d.unit)}</td>
      <td>${esc(tk(`dest.${d.destination}`))}</td>
      <td>${staffCell(d.requestedBy)}</td>
      <td class="nowrap">${esc(fmtDay(localDay(d.timestamp)))} ${fmtTime(d.timestamp)}</td>
      <td>${statusPill(d.status)}${d.rejectionReason ? `<small class="why">${esc(t(d.rejectionReason))}</small>` : ""}</td>
      <td>${d.approvedBy && d.decidedAt ? stampOf(d.approvedBy, d.decidedAt) : "—"}</td>
    </tr>`).join("")}</tbody></table></div>
    ${list.length > shown.length ? `<button type="button" class="btn small more" data-action="dispatch-more">${t("Show more ({n} left)", { n: list.length - shown.length })}</button>` : ""}`;
}

export function renderDispatch(): string {
  const pending = pendingDispatches();
  const now = today();
  const decided = db.dispatches.filter((d) => d.decidedAt && localDay(d.decidedAt) === now);
  const approved = decided.filter((d) => d.status === "APPROVED").length;
  const rejected = decided.filter((d) => d.status === "REJECTED").length;
  const blocked = pending.filter((d) => { const it = item(d.itemId); return !it || it.currentQuantity < d.quantity; }).length;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Dispatch")}</h1>
      <p>${t("Stock requests sent by the Sales Department. Approving moves the stock out; rejecting needs a reason.")}</p></div></div>
    <div class="stat-row">
      <div class="stat"><span>${t("Waiting for you")}</span><strong class="num ${pending.length ? "warn-text" : ""}">${pending.length}</strong></div>
      <div class="stat"><span>${t("Approved today")}</span><strong class="num">${approved}</strong></div>
      <div class="stat"><span>${t("Rejected today")}</span><strong class="num">${rejected}</strong></div>
      <div class="stat"><span>${t("Blocked by stock")}</span><strong class="num ${blocked ? "bad-text" : ""}">${blocked}</strong></div>
    </div>
    <section class="card" aria-labelledby="pendTitle">
      <div class="card-head"><div><h2 id="pendTitle">${t("Pending review")}</h2><p>${t("Oldest first")}</p></div></div>
      ${pending.length ? `<ul class="dispatch-list wide">${pending.map(requestCard).join("")}</ul>` : empty(t("No dispatches waiting"), t("New requests from sales staff appear here."))}
    </section>
    <section class="card" aria-labelledby="histTitle">
      <div class="card-head"><div><h2 id="histTitle">${t("Decision history")}</h2><p>${t("Who approved or rejected, and when")}</p></div>
        ${seg("dispatch-filter", state.dispatchTab, [["ALL", t("All")], ["APPROVED", t("Approved")], ["REJECTED", t("Rejected")]], t("Status"), "small")}</div>
      ${history()}
    </section>`;
}

export const dispatchActions: ActionMap = {
  "dispatch-filter": (el) => {
    const v = el.dataset.value;
    state.dispatchTab = v === "APPROVED" || v === "REJECTED" ? v : "ALL";
    historyLimit = 12;
    rerender(`[data-action="dispatch-filter"][data-value="${state.dispatchTab}"]`);
  },
  "approve-dispatch": (el) => {
    const id = el.dataset.value ?? "";
    const d = db.dispatches.find((x) => x.id === id);
    if (!d) return;
    const res = approveDispatch(id);
    if (!res.ok) {
      toast(res.reason === "stock" ? t("Not enough stock to approve.") : t("This request is no longer pending."));
      return;
    }
    const next = pendingDispatches().find((x) => { const it = item(x.itemId); return it && it.currentQuantity >= x.quantity; });
    rerender(next ? `#dsp-${next.id} [data-action="approve-dispatch"]` : "#pendTitle");
    const it = item(d.itemId);
    const lvl = it ? stockLevel(it) : "OK";
    toast(t("Approved {item} · {q} → {dest} · by {name}", { item: tk(d.itemName), q: qtyUnit(d.quantity, d.unit), dest: tk(`dest.${d.destination}`), name: user().name })
      + ` · ${t("stock {a} → {b}", { a: String(res.before), b: String(res.after) })}` + (lvl !== "OK" ? ` · ${t("now low stock")}` : ""),
      () => { reopenDispatch(id); rerender(); });
  },
  "dispatch-more": () => { historyLimit += 12; rerender(); },
  "reject-dispatch": (el) => openModal({ kind: "reject", id: el.dataset.value ?? "" }, el),
};
