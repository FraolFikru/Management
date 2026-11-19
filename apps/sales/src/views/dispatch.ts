/* Send out: ask a manager of this branch (the clerk picks which one) to
   release stock from the store room to the kitchen, bar, … or to another
   branch (every branch is listed, this one first). Nothing leaves stock until
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

/** branch: "" = this branch (then a place inside it), or another branch's id (a transfer). manager: who it is sent to. */
interface Draft { query: string; itemId: string | null; quantity: string; branch: string; place: string; manager: string; note: string }
const fresh = (keep: Partial<Draft> = {}): Draft =>
  ({ query: "", itemId: null, quantity: "", branch: keep.branch ?? "", place: keep.place ?? "", manager: keep.manager ?? "", note: "" });
let d: Draft = fresh();

/** The manager it goes to: the one picked, or the only one there is. */
const chosenManager = (): { id: string; name: string } | undefined =>
  branchInfo.managers.find((m) => m.id && m.id === d.manager) ?? (branchInfo.managers.length === 1 ? branchInfo.managers[0] : undefined);

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
  const m = chosenManager();
  if (!m) return branchInfo.managers.length ? t("Choose the manager who approves it.") : t("Goes to the manager of {branch} for approval.", { branch: esc(branchInfo.name) });
  return t("Goes to {who}, manager of {branch}, for approval. Stock only leaves the store room once they approve.", { who: esc(m.name), branch: esc(branchInfo.name) });
}

function destinationFields(e: FieldErrors): string {
  const other = branchInfo.branches.find((b) => b.id === d.branch);
  const branchChip = (id: string, label: string, extra = "") =>
    `<button type="button" class="pick-chip" data-action="d-branch" data-value="${esc(id)}" aria-pressed="${d.branch === id}">${icon("store")} ${esc(label)}${extra}</button>`;
  return `
        <div class="field"><span class="label" id="dBrLbl">${t("Branch")}</span>
          <div class="chip-grid" role="group" aria-labelledby="dBrLbl">
            ${branchChip("", branchInfo.name, ` <small class="chip-note">${t("this branch")}</small>`)}
            ${branchInfo.branches.map((b) => branchChip(b.id, b.name)).join("")}
          </div></div>
        ${other
          ? `<p class="hint" id="dTransferHint">${icon("truck")} ${t("A transfer: the stock leaves {from} when the manager approves, and {to}'s manager confirms it arrived.", { from: esc(branchInfo.name), to: esc(other.name) })}</p>`
          : `<div class="field"><span class="label" id="dToLbl">${t("Where in {branch}", { branch: esc(branchInfo.name) })}</span>
          <div class="chip-grid" role="group" aria-labelledby="dToLbl" tabindex="-1" ${invalid(e, "to")}>
            ${branchInfo.places.map((p) => `<button type="button" class="pick-chip" data-action="d-to" data-value="${esc(p)}" aria-pressed="${d.place === p}">${esc(tk(`dest.${p}`))}</button>`).join("")}
          </div>${errText(e, "to")}</div>`}
        <div class="field"><span class="label" id="dMgrLbl">${t("Send to manager")}</span>
          ${branchInfo.managers.length
            ? `<div class="chip-grid" role="group" aria-labelledby="dMgrLbl" tabindex="-1" ${invalid(e, "manager")}>
            ${branchInfo.managers.map((m) => `<button type="button" class="pick-chip" data-action="d-manager" data-value="${esc(m.id)}" aria-pressed="${chosenManager()?.id === m.id}" ${m.id ? "" : "disabled"}>${icon("user")} ${esc(m.name)}</button>`).join("")}
          </div>${errText(e, "manager")}`
            : `<p class="hint warn-text">${icon("alert")} ${t("{branch} has no manager yet. Ask the System Admin to add one in the Admin app; until then the Owner or a System Admin can approve.", { branch: esc(branchInfo.name) })}</p>`}
        </div>`;
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
  if (!branchInfo.known) {
    return `<div class="page-head"><div><h1>${t("Send out")}</h1></div></div>
      <section class="card"><div class="empty"><strong>${t("The server needs an update")}</strong>
        <p>${t("It doesn't send this branch's managers and the other branches yet. Ask whoever runs the server to redeploy it, then reload this page.")}</p></div></section>`;
  }
  return `
    <div class="page-head"><div><h1>${t("Send out")}</h1><p>${t("Ask the manager to release stock from the store room to the kitchen, bar or another branch.")}</p></div></div>
    <div class="split">
      <form class="card form" id="dispatchForm" novalidate aria-labelledby="dfTitle">
        <h2 id="dfTitle" class="sec-title" tabindex="-1">${t("New dispatch request")}</h2>
        <div class="field"><label for="dItem">${t("Stock item")}</label>
          <div class="combo">
            <input id="dItem" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dItemList"
              autocomplete="off" placeholder="${t("Type to search, e.g. “tom” for Tomato")}" value="${esc(it ? tk(it.nameKey) : d.query)}" data-bind="dispatch.query" ${invalid(e, "item")}>
            <ul id="dItemList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
          </div>${errText(e, "item")}</div>
        <div class="field"><label for="dQty">${t("Quantity")}</label>
          <div class="affix right"><input id="dQty" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(d.quantity)}" data-bind="dispatch.quantity" ${invalid(e, "qty")}><span>${it ? esc(unitName(it.unit)) : ""}</span></div>
          <div id="dStock">${it ? stockHint(it) : ""}</div>${errText(e, "qty")}</div>
${destinationFields(e)}
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
    <div class="entry-meta"><span>${esc(r.requestedByName || r.requestedBy)}${r.assignedToName ? ` → ${esc(r.assignedToName)}` : ""} · ${esc(relDay(localDay(r.timestamp)))} ${fmtTime(r.timestamp)}</span>${status}</div>
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
  if (!d.branch && !d.place) errors.to = t("Choose where it goes.");
  if (branchInfo.managers.length > 1 && !chosenManager()) errors.manager = t("Choose the manager who approves it.");
  if (showErrors(errors, ["item", "qty", "to", "manager"]) || !it) {
    if (errors.to && !errors.item && !errors.qty) $<HTMLElement>('[data-action="d-to"]')?.focus();
    else if (errors.manager && !errors.item && !errors.qty) $<HTMLElement>('[data-action="d-manager"]')?.focus();
    return;
  }
  const mgr = chosenManager();
  const rec = sendDispatch({ itemId: it.id, quantity: q, ...(d.branch ? { toBranchId: d.branch } : { destination: d.place }), note: d.note.trim(),
    ...(mgr?.id ? { managerId: mgr.id } : {}) });
  if (!rec) return;
  d = fresh({ branch: d.branch, place: d.place, manager: d.manager });
  state.errors = {};
  // focus the heading, not the item box: an open suggestion list would cover the branch and manager buttons
  rerender("#dfTitle");
  const who = mgr?.name ?? t("the manager");
  toast(t("Sent to {who} for approval: {item} {q} → {to}", { who, item: tk(it.nameKey), q: qtyU(q, it.unit), to: destName(rec) }));
}

export const dispatchActions: ActionMap = {
  "d-to": (el) => {
    d.place = el.dataset.value ?? "";
    clearErrors(["to"]);
    document.querySelectorAll<HTMLElement>('[data-action="d-to"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  },
  "d-branch": (el) => {
    d.branch = el.dataset.value ?? "";
    clearErrors(["to"]);
    rerender(`[data-action="d-branch"][data-value="${CSS.escape(d.branch)}"]`);
  },
  "d-manager": (el) => {
    d.manager = el.dataset.value ?? "";
    clearErrors(["manager"]);
    document.querySelectorAll<HTMLElement>('[data-action="d-manager"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
    const line = document.querySelector(".total-bar .stamp");
    if (line) line.innerHTML = `${icon("user")} ${managerLine()}`;
  },
  "d-cancel": (el) => {
    const r = cancelDispatch(el.dataset.value ?? "");
    if (!r) return;
    rerender();
    toast(t("Cancelled the request for {item}", { item: tk(r.itemName) }));
  },
};
