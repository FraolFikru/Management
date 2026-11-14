/* Waste & shrinkage: report lost stock with a reason, quantity and
   estimated value. The reporter is stamped automatically; managers
   approve or reject each report so losses are reviewed, not hidden. */

import type { FieldErrors, InventoryItem, WasteReason, WasteRecord } from "../types";
import { t, tk } from "../i18n";
import { localDay, money, num, parseAmount, plain, relDay, round2, stamp, today } from "../format";
import { COGS_COLOR, NOTE_REQUIRED, WASTE_IDS, isWasteReason } from "../catalog";
import { newId } from "../seed";
import {
  canApproveWaste, canDelete, db, decideWaste, inventoryItem, inPeriod, lastCost, recordWaste, removeRecord, restoreRecord,
  state, stampUser, user,
} from "../store";
import { $, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboResult } from "../ui/combobox";
import { recentItems, searchItems } from "../ui/itemsearch";
import { byline, clearErrors, errText, invalid, metricsBar, seg, showErrors } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft {
  query: string;
  itemId: string | null;
  reason: WasteReason | "";
  quantity: string;
  unitCost: string;
  value: string;
  valueEdited: boolean;
  date: string;
  notes: string;
}

const fresh = (): Draft => ({ query: "", itemId: null, reason: "", quantity: "", unitCost: "", value: "", valueEdited: false, date: today(), notes: "" });
let d: Draft = fresh();

const item = (): InventoryItem | undefined => (d.itemId ? inventoryItem(d.itemId) : undefined);

function source(query: string): ComboResult<InventoryItem> {
  const q = query.trim();
  const hits = q ? searchItems(q, 8) : recentItems(8).map((item) => ({ item, start: -1, nearMiss: false }));
  const unsure = q !== "" && hits.length > 0 && hits.every((h) => h.nearMiss);
  return {
    preselect: unsure ? -1 : undefined,
    heading: hits.length ? (!q ? t("Bought recently") : unsure ? t("Did you mean?") : t("Stock items")) : "",
    options: hits.map(({ item: it, start }) => {
      const name = tk(it.nameKey);
      return {
        value: it,
        html: `<span class="opt-main"><span class="opt-name">${start >= 0 ? highlight(name, start, q.length) : esc(name)}</span>
          <span class="opt-crumb"><i class="dot" style="background:${COGS_COLOR[it.category]}"></i>${esc(tk(`cogs.${it.category}`))}</span></span>
          <span class="opt-side"><span class="mono">${money(lastCost(it.id) ?? it.unitCost)}/${esc(tk(`unit.${it.unit}`))}</span></span>`,
      };
    }),
  };
}

export function renderWaste(): string {
  const e: FieldErrors = state.errors;
  const it = item();
  const needsNote = d.reason !== "" && NOTE_REQUIRED.has(d.reason);
  const rows = db.waste
    .filter((w) => inPeriod(w.timestamp) || w.approval === "PENDING")
    .filter((w) => state.wasteFilter === "ALL" || w.approval === "PENDING")
    .sort((a, b) => (a.approval === "PENDING" ? -1 : 0) - (b.approval === "PENDING" ? -1 : 0) || (a.timestamp < b.timestamp ? 1 : -1));
  const pendingCount = db.waste.filter((w) => w.approval === "PENDING").length;

  return `
    <div class="page-head"><div><h1>${t("Waste & shrinkage")}</h1><p>${t("Report stock that was lost so the real food cost is visible.")}</p></div></div>
    ${metricsBar()}
    <div class="split">
      <form class="card form" id="wasteForm" novalidate aria-labelledby="wfTitle">
        <h2 id="wfTitle" class="sec-title">${t("New waste report")}</h2>
        <div class="field"><span class="label" id="reasonLbl">${t("Reason")}</span>
          <div class="reason-grid" role="group" aria-labelledby="reasonLbl" ${invalid(e, "reason")} tabindex="-1">
            ${WASTE_IDS.map((r) => `<button type="button" class="reason" data-action="waste-reason" data-value="${r}" aria-pressed="${d.reason === r}">${esc(tk(`waste.${r}`))}</button>`).join("")}
          </div>${errText(e, "reason")}</div>
        <div class="field"><label for="wItem">${t("Stock item")}</label>
          <div class="combo">
            <input id="wItem" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wItemList"
              autocomplete="off" placeholder="${t("Type to search, e.g. “tom” for Tomato")}" value="${esc(d.query)}" data-bind="waste.query" ${invalid(e, "item")}>
            <ul id="wItemList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
          </div>
          <p class="hint">${it ? `${esc(tk(`cogs.${it.category}`))} · ${t("valued at {x} per {u}", { x: money(parseAmount(d.unitCost) || 0), u: tk(`unit.${it.unit}`) })}` : t("Pick from the stock catalog so the loss is valued at the last purchase cost.")}</p>
          ${errText(e, "item")}</div>
        <div class="row r3">
          <div class="field"><label for="wQty">${t("Quantity lost")}</label>
            <div class="affix right"><input id="wQty" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(d.quantity)}" data-bind="waste.quantity" ${invalid(e, "qty")}><span>${it ? esc(tk(`unit.${it.unit}`)) : ""}</span></div>${errText(e, "qty")}</div>
          <div class="field"><label for="wValue">${t("Estimated loss value")}</label>
            <div class="affix"><span>ETB</span><input id="wValue" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(d.value)}" data-bind="waste.value" ${invalid(e, "value")}></div>${errText(e, "value")}</div>
          <div class="field"><label for="wDate">${t("Date")}</label><input id="wDate" class="input" type="date" max="${today()}" value="${esc(d.date)}" data-bind="waste.date"></div>
        </div>
        <div class="field"><label for="wNotes">${t("Reason notes")} ${needsNote ? `<span class="req">${t("(required)")}</span>` : `<span class="opt-label">${t("(optional)")}</span>`}</label>
          <textarea id="wNotes" class="input" rows="2" placeholder="${t("What happened? e.g. fridge door left open overnight")}" data-bind="waste.notes" ${invalid(e, "notes")}>${esc(d.notes)}</textarea>${errText(e, "notes")}</div>
        <div class="total-bar">
          <div><span class="label">${t("Loss")}</span><output id="wSum" aria-live="polite">${money(parseAmount(d.value) || 0, 2)}</output>
            <small class="stamp">${icon("user")} ${t("Reported by {name}", { name: esc(user().name) })} · ${canApproveWaste() ? t("approved automatically") : t("needs manager approval")}</small></div>
          <div class="form-actions"><button type="submit" class="btn primary">${icon("check")} ${t("Submit report")}</button></div>
        </div>
      </form>
      <aside class="side">
        <section class="card">
          <div class="card-head"><div><h2>${t("Waste reports")}</h2><p>${pendingCount ? t("{n} awaiting approval", { n: pendingCount }) : t("All reports reviewed")}</p></div>
            ${seg("waste-filter", state.wasteFilter, [["ALL", t("All")], ["PENDING", t("Pending")]], t("Filter"), "small")}</div>
          ${rows.length ? `<ul class="entry-list">${rows.slice(0, 20).map(wasteRow).join("")}</ul>` : `<div class="empty"><strong>${t("Nothing to show")}</strong></div>`}
        </section>
      </aside>
    </div>`;
}

function wasteRow(w: WasteRecord): string {
  const status = w.approval === "APPROVED" ? `<span class="tag paid">${t("Approved")}</span>`
    : w.approval === "REJECTED" ? `<span class="tag overdue">${t("Rejected")}</span>` : `<span class="tag pending">${t("Pending")}</span>`;
  return `<li class="entry row-hover ${w.approval.toLowerCase()}">
    <strong>${esc(tk(w.itemName))} <span class="meta">· ${esc(tk(`waste.${w.reason}`))}</span></strong>
    <span class="num ${w.approval === "REJECTED" ? "struck" : ""}">${money(w.lossValue)}</span>
    <div class="entry-meta"><span>${num(w.quantityLost)} ${esc(tk(`unit.${w.unit}`))} · ${relDay(localDay(w.timestamp))}</span>${status}</div>
    ${w.customNotes ? `<p class="note">“${esc(w.customNotes)}”</p>` : ""}
    <div class="entry-meta"><span>${t("Reported by")} ${byline(w.reportedBy, w.timestamp)}</span>
      ${w.approvedBy ? `<span>${w.approval === "APPROVED" ? t("Approved by") : t("Rejected by")} ${esc(w.approvedBy)}</span>` : ""}</div>
    ${w.approval === "PENDING" && canApproveWaste() ? `<div class="entry-actions">
      <button type="button" class="btn small" data-action="waste-reject" data-value="${w.id}">${icon("x")} ${t("Reject")}</button>
      <button type="button" class="btn small primary" data-action="waste-approve" data-value="${w.id}">${icon("check")} ${t("Approve")}</button></div>` : ""}
    ${canDelete() && w.approval !== "PENDING" ? "" : ""}
  </li>`;
}

function revalue(): void {
  if (d.valueEdited) return;
  const q = parseAmount(d.quantity), c = parseAmount(d.unitCost);
  d.value = q > 0 && c >= 0 ? plain(q * c) : "";
  if (d.value) clearErrors(["value"]);
  const el = $<HTMLInputElement>("#wValue");
  if (el) el.value = d.value;
  const sum = $("#wSum");
  if (sum) sum.textContent = money(parseAmount(d.value) || 0, 2);
}

export function mountWaste(): void {
  const input = $<HTMLInputElement>("#wItem");
  const list = $<HTMLUListElement>("#wItemList");
  if (input && list) {
    attachCombobox(input, list, source, (o) => {
      d.itemId = o.value.id;
      d.query = tk(o.value.nameKey);
      d.unitCost = plain(lastCost(o.value.id) ?? o.value.unitCost);
      d.valueEdited = false;
      delete state.errors.item;
      rerender("#wQty");
    });
  }
}

export function onWasteInput(key: string, value: string): void {
  if (key === "query") { d.query = value; if (d.itemId && tk(item()?.nameKey ?? "") !== value) d.itemId = null; clearErrors(["item"]); }
  else if (key === "quantity") { d.quantity = value; clearErrors(["qty"]); revalue(); }
  else if (key === "value") {
    d.value = value;
    d.valueEdited = value.trim() !== "";
    clearErrors(["value"]);
    const sum = $("#wSum");
    if (sum) sum.textContent = money(parseAmount(value) || 0, 2);
  } else if (key === "date") d.date = value;
  else if (key === "notes") { d.notes = value; clearErrors(["notes"]); }
}

function submit(): void {
  const it = item();
  const q = parseAmount(d.quantity), v = parseAmount(d.value);
  const errors: FieldErrors = {};
  if (!d.reason) errors.reason = t("Choose why the stock was lost.");
  if (!it) errors.item = t("Pick a stock item from the list.");
  if (!(q > 0)) errors.qty = t("Enter the quantity lost.");
  if (!(v >= 0) || Number.isNaN(v)) errors.value = t("Enter the estimated value (0 or more).");
  if (d.reason && NOTE_REQUIRED.has(d.reason) && !d.notes.trim()) errors.notes = t("Explain what happened.");
  if (showErrors(errors, ["reason", "item", "qty", "value", "notes"]) || !it || !d.reason) return;

  const { loggedBy, userId } = stampUser();
  const ts = d.date === today() ? new Date().toISOString() : stamp(d.date, 20);
  const auto = canApproveWaste();
  const rec: WasteRecord = {
    id: newId("wst"), itemId: it.id, itemName: it.nameKey, quantityLost: q, unit: it.unit, lossValue: round2(v),
    reason: d.reason, customNotes: d.notes.trim() || undefined, reportedBy: loggedBy, timestamp: ts,
    unitCost: parseAmount(d.unitCost) || 0, userId, approval: auto ? "APPROVED" : "PENDING",
    approvedBy: auto ? loggedBy : null, approvedAt: auto ? ts : null,
  };
  recordWaste(rec);
  d = fresh();
  state.errors = {};
  rerender("#wItem");
  toast(t("Waste report saved · {item} · {x} · by {name}", { item: tk(it.nameKey), x: money(rec.lossValue, 2), name: loggedBy }), () => {
    removeRecord("WASTE", rec.id);
    rerender();
  });
}

export const submitWaste = submit;

export const wasteActions: ActionMap = {
  "waste-reason": (el) => {
    const v = el.dataset.value ?? "";
    if (!isWasteReason(v)) return;
    d.reason = v;
    clearErrors(["reason"]);
    rerender(`[data-action="waste-reason"][data-value="${v}"]`);
  },
  "waste-filter": (el) => { state.wasteFilter = el.dataset.value === "PENDING" ? "PENDING" : "ALL"; rerender(`[data-action="waste-filter"][data-value="${state.wasteFilter}"]`); },
  "waste-approve": (el) => {
    const w = decideWaste(el.dataset.value ?? "", true);
    if (!w) return;
    rerender();
    toast(t("Approved by {name}", { name: user().name }));
  },
  "waste-reject": (el) => {
    const w = decideWaste(el.dataset.value ?? "", false);
    if (!w) return;
    rerender();
    toast(t("Rejected by {name}", { name: user().name }));
  },
  "waste-delete": (el) => {
    const removed = removeRecord("WASTE", el.dataset.value ?? "");
    if (removed) { rerender(); toast(t("Deleted by {name}", { name: user().name }), () => { restoreRecord(removed); rerender(); }); }
  },
};
