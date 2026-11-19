/* Send out: ask this branch's manager to release stock from the store room
   to the kitchen, bar, … or to another branch. Nothing leaves stock until
   the manager approves it on their Dispatch page; the decision (and a
   rejection reason) comes back here. */

import type { DispatchRequest, FieldErrors, InventoryItem } from "../types";
import { t, tk } from "../i18n";
import { fmtTime, localDay, num, parseAmount, relDay } from "../format";
import { COGS_COLOR } from "../catalog";
import { branchInfo, cancelDispatch, db, inventoryItem, sendDispatch, state, user } from "../store";
import { $, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboResult } from "../ui/combobox";
import { recentItems, searchItems } from "../ui/itemsearch";
import { clearErrors, errText, invalid, showErrors } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft { query: string; itemId: string | null; quantity: string; to: string; note: string }
const fresh = (keep: Partial<Draft> = {}): Draft => ({ query: "", itemId: null, quantity: "", to: keep.to ?? "", note: "" });
let d: Draft = fresh();

const item = (): InventoryItem | undefined => (d.itemId ? inventoryItem(d.itemId) : undefined);
const unitName = (u: string): string => tk(`unit.${u}`);
const qtyU = (q: number, u: string): string => `${num(q)} ${unitName(u)}`;
const inStore = (id: string): number | undefined => branchInfo.stock[id];

/** "Kitchen line" or "Piassa Branch" */
export function destName(r: Pick<DispatchRequest, "destination" | "toBranchName">): string {
  return r.toBranchName ? r.toBranchName : tk(`dest.${r.destination}`);
}

function source(query: string): ComboResult<InventoryItem> {
  const q = query.trim();
  const hits = q ? searchItems(q, 8) : recentItems(8).map((it) => ({ item: it, start: -1, nearMiss: false }));
  const unsure = q !== "" && hits.length > 0 && hits.every((h) => h.nearMiss);
  return {
    preselect: unsure ? -1 : undefined,
    heading: hits.length ? (!q ? t("Bought recently") : unsure ? t("Did you mean?") : t("Stock items")) : "",
    options: hits.map(({ item: it, start }) => {
      const name = tk(it.nameKey);
      const have = inStore(it.id);
      return {
        value: it,
        html: `<span class="opt-main"><span class="opt-name">${start >= 0 ? highlight(name, start, q.length) : esc(name)}</span>
          <span class="opt-crumb"><i class="dot" style="background:${COGS_COLOR[it.category]}"></i>${esc(tk(`cogs.${it.category}`))}</span></span>
          ${have !== undefined ? `<span class="opt-side"><span class="mono">${t("{q} in store", { q: qtyU(have, it.unit) })}</span></span>` : ""}`,
      };
    }),
  };
}

function managerLine(): string {
  const m = branchInfo.managers;
  const who = m.length ? m.join(", ") : t("the branch manager");
  return t("Goes to {who}, manager of {branch}, for approval. Stock only leaves the store room once they approve.", { who: esc(who), branch: esc(branchInfo.name) });
}

function stockHint(it: InventoryItem): string {
  const have = inStore(it.id);
  if (have === undefined) return "";
  const q = parseAmount(d.quantity);
  if (q > have) return `<p class="hint warn-text" id="dStockHint">${icon("alert")} ${t("Only {q} in the store room. The manager can't approve more than that.", { q: qtyU(have, it.unit) })}</p>`;
  return `<p class="hint" id="dStockHint">${t("{q} in the store room", { q: qtyU(have, it.unit) })}${q > 0 ? ` · ${t("{q} left after", { q: qtyU(have - q, it.unit) })}` : ""}</p>`;
}

export function renderDispatch(): string {
  const e: FieldErrors = state.errors;
  const it = item();
  const places = branchInfo.places;
  return `
    <div class="page-head"><div><h1>${t("Send out")}</h1><p>${t("Ask the manager to release stock from the store room to the kitchen, bar or another branch.")}</p></div></div>
    <div class="split">
      <form class="card form" id="dispatchForm" novalidate aria-labelledby="dfTitle">
        <h2 id="dfTitle" class="sec-title">${t("New dispatch request")}</h2>
        <div class="field"><label for="dItem">${t("Stock item")}</label>
          <div class="combo">
            <input id="dItem" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dItemList"
              autocomplete="off" placeholder="${t("Type to search, e.g. “tom” for Tomato")}" value="${esc(it ? tk(it.nameKey) : d.query)}" data-bind="dispatch.query" ${invalid(e, "item")}>
            <ul id="dItemList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
          </div>${errText(e, "item")}</div>
        <div class="field"><label for="dQty">${t("Quantity")}</label>
          <div class="affix right"><input id="dQty" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(d.quantity)}" data-bind="dispatch.quantity" ${invalid(e, "qty")}><span>${it ? esc(unitName(it.unit)) : ""}</span></div>
          <div id="dStock">${it ? stockHint(it) : ""}</div>${errText(e, "qty")}</div>
        <div class="field"><span class="label" id="dToLbl">${t("Send to")}</span>
          <div class="chip-grid" role="group" aria-labelledby="dToLbl" tabindex="-1" ${invalid(e, "to")}>
            ${places.map((p) => `<button type="button" class="pick-chip" data-action="d-to" data-value="${esc(p)}" aria-pressed="${d.to === p}">${esc(tk(`dest.${p}`))}</button>`).join("")}
            ${branchInfo.branches.map((b) => `<button type="button" class="pick-chip" data-action="d-to" data-value="branch:${esc(b.id)}" aria-pressed="${d.to === `branch:${b.id}`}">${icon("store")} ${esc(b.name)}</button>`).join("")}
          </div>${errText(e, "to")}</div>
        <div class="field"><label for="dNote">${t("Note for the manager")} <span class="opt-label">${t("(optional)")}</span></label>
          <input id="dNote" class="input" type="text" placeholder="${t("e.g. for tonight's event, chef asked for it")}" value="${esc(d.note)}" data-bind="dispatch.note"></div>
        <div class="total-bar">
          <div><span class="label">${t("Approval")}</span>
            <small class="stamp">${icon("user")} ${managerLine()}</small></div>
          <div class="form-actions"><button type="submit" class="btn primary">${icon("truck")} ${t("Send for approval")}</button></div>
        </div>
      </form>
      <aside class="side" id="dispatchSide">${sidePanel()}</aside>
    </div>`;
}

/** The list beside the form (redrawn on its own when the manager decides, so typing isn't disturbed). */
export function sidePanel(): string {
  const mine = db.dispatches.slice().sort((a, b) => (a.status === "PENDING" ? -1 : 0) - (b.status === "PENDING" ? -1 : 0) || (a.timestamp < b.timestamp ? 1 : -1));
  const waiting = db.dispatches.filter((x) => x.status === "PENDING").length;
  return `
        <section class="card">
          <div class="card-head"><div><h2>${t("Sent to the manager")}</h2><p>${waiting ? t("{n} waiting for a decision", { n: waiting }) : t("Nothing waiting")}</p></div></div>
          ${mine.length ? `<ul class="entry-list">${mine.slice(0, 30).map(row).join("")}</ul>` : `<div class="empty"><strong>${t("Nothing sent yet")}</strong></div>`}
        </section>`;
}

export function refreshDispatchSide(): void {
  const el = $("#dispatchSide");
  if (el) el.innerHTML = sidePanel();
}

function row(r: DispatchRequest): string {
  const name = tk(r.itemName) !== r.itemName ? tk(r.itemName) : r.name || r.itemId;
  const status = r.status === "APPROVED" ? `<span class="tag paid">${t("Approved")}</span>`
    : r.status === "REJECTED" ? `<span class="tag overdue">${t("Rejected")}</span>` : `<span class="tag pending">${t("Waiting for the manager")}</span>`;
  const mineToCancel = r.status === "PENDING" && r.requestedBy === user().userId && !r.id.startsWith("local-");
  return `<li class="entry row-hover ${r.status.toLowerCase()}">
    <strong>${esc(name)} <span class="meta">→ ${esc(destName(r))}</span></strong>
    <span class="num">${qtyU(r.quantity, r.unit)}</span>
    <div class="entry-meta"><span>${esc(r.requestedByName || r.requestedBy)} · ${esc(relDay(localDay(r.timestamp)))} ${fmtTime(r.timestamp)}</span>${status}</div>
    ${r.note ? `<p class="note">“${esc(r.note)}”</p>` : ""}
    ${r.status === "REJECTED" && r.rejectionReason ? `<p class="note bad-text">${t("Rejected by {name}: {reason}", { name: esc(r.approvedByName || ""), reason: esc(r.rejectionReason) })}</p>` : ""}
    ${r.status === "APPROVED" && r.approvedByName ? `<div class="entry-meta"><span>${t("Approved by {name}", { name: esc(r.approvedByName) })}</span></div>` : ""}
    ${mineToCancel ? `<div class="entry-actions"><button type="button" class="btn small ghost" data-action="d-cancel" data-value="${esc(r.id)}">${t("Cancel request")}</button></div>` : ""}
  </li>`;
}

/* ---------- behaviour ---------- */

function pick(it: InventoryItem): void {
  d.itemId = it.id;
  d.query = "";
  clearErrors(["item"]);
  rerender("#dQty");
}

export function mountDispatch(): void {
  const input = $<HTMLInputElement>("#dItem");
  const list = $<HTMLUListElement>("#dItemList");
  if (input && list) attachCombobox(input, list, source, (o) => pick(o.value));
}

export function onDispatchInput(key: string, value: string): void {
  if (key === "query") { d.query = value; if (d.itemId) d.itemId = null; clearErrors(["item"]); }
  else if (key === "quantity") {
    d.quantity = value;
    clearErrors(["qty"]);
    const it = item();
    const box = $("#dStock");
    if (it && box) box.innerHTML = stockHint(it);
  }
  else if (key === "note") d.note = value;
}

export function submitDispatch(): void {
  const it = item();
  const q = parseAmount(d.quantity);
  const errors: FieldErrors = {};
  if (!it) errors.item = t("Choose the item from the list.");
  if (!(q > 0)) errors.qty = t("Enter a quantity above 0.");
  if (!d.to) errors.to = t("Choose where it goes.");
  if (showErrors(errors, ["item", "qty", "to"]) || !it) {
    if (errors.to && !errors.item && !errors.qty) $<HTMLElement>('[data-action="d-to"]')?.focus();
    return;
  }
  const toBranchId = d.to.startsWith("branch:") ? d.to.slice(7) : undefined;
  const rec = sendDispatch({ itemId: it.id, quantity: q, ...(toBranchId ? { toBranchId } : { destination: d.to }), note: d.note.trim() });
  if (!rec) return;
  d = fresh({ to: d.to });
  state.errors = {};
  rerender("#dItem");
  const who = branchInfo.managers[0] ?? t("the manager");
  toast(t("Sent to {who} for approval: {item} {q} → {to}", { who, item: tk(it.nameKey), q: qtyU(q, it.unit), to: destName(rec) }));
}

export const dispatchActions: ActionMap = {
  "d-to": (el) => {
    d.to = el.dataset.value ?? "";
    clearErrors(["to"]);
    document.querySelectorAll<HTMLElement>('[data-action="d-to"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  },
  "d-cancel": (el) => {
    const r = cancelDispatch(el.dataset.value ?? "");
    if (!r) return;
    rerender();
    toast(t("Cancelled the request for {item}", { item: tk(r.itemName) }));
  },
};
