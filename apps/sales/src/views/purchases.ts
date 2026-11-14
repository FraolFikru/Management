/* Purchases (buying only). Search the item first — the items bought most
   often are listed before anything is typed, and a few letters find the
   rest. Something new? "Add as a new item" saves it to the shared catalog
   once (with its group, unit and price), so next time it's just a search.
   Then quantity × unit cost (two-way total), supplier and how it was paid
   (Cash, Telebirr, CBE Birr). No receipt or invoice is needed. */

import type { FieldErrors, InventoryItem, MainCategory, PurchaseRecord } from "../types";
import { registerText, t, tk } from "../i18n";
import { localDay, money, num, parseAmount, plain, relDay, round2, stamp, today, fmtDay } from "../format";
import { EXPENSE_METHODS, MAIN_COLOR, MAIN_IDS, MAIN_TO_COGS, UNIT_CODES, isExpenseMethod, isMain } from "../catalog";
import { newId } from "../seed";
import {
  canDelete, db, inPeriod, inventory, inventoryItem, lastCost, recordPurchase, removeRecord, restoreRecord, state, stampUser, user, vendors, recordItem,
} from "../store";
import { $, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboOption, type ComboResult } from "../ui/combobox";
import { itemNamed, recentItems, searchItems } from "../ui/itemsearch";
import { byline, clearErrors, errText, invalid, methodGrid, metricsBar, payName, periodSeg, setPressed, showErrors } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft {
  itemId: string | null;
  /** adding a brand-new item to the catalog */
  creating: boolean;
  newName: string;
  newMain: MainCategory | "";
  search: string;
  /** "browse by group" panel: the group being looked at */
  browseMain: MainCategory | "";
  quantity: string;
  unit: string;
  unitCost: string;
  total: string;
  lastEdited: "cost" | "total";
  vendor: string;
  date: string;
  method: PurchaseRecord["paymentMethod"];
  note: string;
}

const fresh = (keep: Partial<Draft> = {}): Draft => ({
  itemId: null, creating: false, newName: "", newMain: "", search: "", browseMain: "", quantity: "", unit: "kg", unitCost: "", total: "",
  lastEdited: "cost", vendor: keep.vendor ?? "", date: keep.date ?? today(), method: keep.method ?? "CASH", note: "",
});

let d: Draft = fresh();

const mainName = (m: MainCategory): string => tk(`main.${m}`);
const dot = (m: MainCategory): string => `<i class="dot" style="background:${MAIN_COLOR[m]}"></i>`;
/** "carrot" → "Carrot" (only the first letter; the rest as typed) */
const tidyName = (s: string): string => { const x = s.trim().replace(/\s+/g, " "); return x.charAt(0).toLocaleUpperCase() + x.slice(1); };

/* ---------- item search ---------- */

type Pick = InventoryItem | { create: string };

const optionHtml = (item: InventoryItem, start = -1, len = 0): string => {
  const name = tk(item.nameKey);
  return `<span class="opt-main"><span class="opt-name">${start >= 0 ? highlight(name, start, len) : esc(name)}</span>
    <span class="opt-crumb">${dot(item.main)}${esc(mainName(item.main))}</span></span>
    <span class="opt-side"><span class="mono">${money(lastCost(item.id) ?? item.unitCost)}/${esc(tk(`unit.${item.unit}`))}</span></span>`;
};

function source(query: string): ComboResult<Pick> {
  const q = query.trim();
  if (!q) {
    const recent = recentItems(8);
    return { heading: recent.length ? t("Bought recently") : "", options: recent.map((item) => ({ value: item, html: optionHtml(item) })) };
  }
  const hits = searchItems(q, 8);
  const options: ComboOption<Pick>[] = hits.map(({ item, start }) => ({ value: item, html: optionHtml(item, start, q.length) }));
  if (!itemNamed(q)) {
    options.push({ value: { create: tidyName(q) }, variant: "create", html: `${icon("plus")} ${t("Add “{x}” as a new item", { x: esc(tidyName(q)) })}` });
  }
  // only near-misses ("beet" ~ Beef): show them, but let the person choose — Enter mustn't pick the wrong item
  const unsure = hits.length > 0 && hits.every((h) => h.nearMiss);
  return { heading: !hits.length ? "" : unsure ? t("Did you mean?") : t("Your items"), options, preselect: unsure ? -1 : 0 };
}

/* ---------- form ---------- */

function pickedCard(item: InventoryItem): string {
  return `
    <div class="picked" role="status">
      <span class="picked-name">${dot(item.main)}<strong>${esc(tk(item.nameKey))}</strong>
        <span class="meta">${esc(mainName(item.main))} · ${t("booked as {c}", { c: esc(tk(`cogs.${item.category}`)) })}</span></span>
      <button type="button" class="btn small ghost" data-action="p-clear">${t("Change")}</button>
    </div>`;
}

function newItemPanel(e: FieldErrors): string {
  return `
    <div class="new-item-panel">
      <div class="new-item-head"><strong>${icon("plus")} ${t("New item")}</strong>
        <button type="button" class="btn small ghost" data-action="p-clear">${t("Cancel")}</button></div>
      <div class="field"><label for="pNewName">${t("Name")}</label>
        <input id="pNewName" class="input" autocomplete="off" placeholder="${t("e.g. Carrot")}" value="${esc(d.newName)}" data-bind="purchase.newName" ${invalid(e, "item")}>
        ${errText(e, "item")}</div>
      <div class="field"><span class="label" id="pNewMainLbl">${t("Group")}</span>
        <div class="chip-grid mains" role="group" aria-labelledby="pNewMainLbl">${MAIN_IDS.map((m) =>
          `<button type="button" class="pick-chip cat" data-action="p-new-main" data-value="${m}" aria-pressed="${d.newMain === m}">${dot(m)}${esc(mainName(m))}</button>`).join("")}</div>
        ${errText(e, "main")}</div>
      <p class="hint">${t("Saved to your item list. Next time just search for it.")}</p>
    </div>`;
}

function browsePanel(): string {
  const items = d.browseMain ? inventory().filter((i) => i.main === d.browseMain).sort((a, b) => tk(a.nameKey).localeCompare(tk(b.nameKey))) : [];
  return `
    <details class="browse" ${d.browseMain ? "open" : ""}>
      <summary>${t("Or browse by group")}</summary>
      <div class="chip-grid mains" role="group" aria-label="${t("Groups")}">${MAIN_IDS.map((m) =>
        `<button type="button" class="pick-chip cat" data-action="p-main" data-value="${m}" aria-pressed="${d.browseMain === m}">${dot(m)}${esc(mainName(m))}</button>`).join("")}</div>
      ${d.browseMain ? `<div class="chip-grid items" role="group" aria-label="${esc(mainName(d.browseMain))}">
        ${items.map((i) => `<button type="button" class="pick-chip" data-action="p-item" data-value="${i.id}">${esc(tk(i.nameKey))}</button>`).join("")}
        <button type="button" class="pick-chip add" data-action="p-new" data-value="${d.browseMain}">${icon("plus")} ${t("Other item")}</button>
      </div>` : ""}
    </details>`;
}

function itemArea(e: FieldErrors): string {
  const item = d.itemId ? inventoryItem(d.itemId) : undefined;
  if (item) return pickedCard(item);
  if (d.creating) return newItemPanel(e);
  return `
    <div class="combo">
      <input id="pSearch" class="input input-lg" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="pSearchList"
        autocomplete="off" placeholder="${t("Type a few letters, e.g. “car” for Carrot")}" value="${esc(d.search)}" data-bind="purchase.search" ${invalid(e, "item")}>
      <ul id="pSearchList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
    </div>
    ${errText(e, "item")}
    ${browsePanel()}`;
}

export function renderPurchases(): string {
  const e: FieldErrors = state.errors;
  return `
    <div class="page-head"><div><h1>${t("Purchases")}</h1><p>${t("Record what was bought for the kitchen and bar. This app is for buying only.")}</p></div>
      ${periodSeg()}</div>
    ${metricsBar()}
    <div class="split">
      <form class="card form" id="purchaseForm" novalidate aria-labelledby="pfTitle">
        <h2 id="pfTitle" class="sec-title">${t("New purchase")}</h2>
        <div class="field"><label for="pSearch" id="pItemLbl">${t("Item")}</label>
          <div id="pItemArea">${itemArea(e)}</div></div>
        <div class="row r4">
          <div class="field"><label for="pQty">${t("Quantity")}</label>
            <input id="pQty" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(d.quantity)}" data-bind="purchase.quantity" ${invalid(e, "qty")}>${errText(e, "qty")}</div>
          <div class="field"><label for="pUnit">${t("Unit")}</label>
            <select id="pUnit" class="input" data-bind="purchase.unit">${UNIT_CODES.map((u) => `<option value="${u}" ${u === d.unit ? "selected" : ""}>${esc(tk(`unit.${u}`))}</option>`).join("")}</select></div>
          <div class="field"><label for="pCost">${t("Unit cost")}</label>
            <div class="affix"><span>ETB</span><input id="pCost" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(d.unitCost)}" data-bind="purchase.unitCost"></div></div>
          <div class="field"><label for="pTotal">${t("Total cost")}</label>
            <div class="affix"><span>ETB</span><input id="pTotal" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(d.total)}" data-bind="purchase.total" ${invalid(e, "total")}></div>${errText(e, "total")}</div>
        </div>
        <p class="hint">${t("Type the unit cost or the total paid; the other is calculated.")}</p>
        <div class="row">
          <div class="field"><label for="pVendor">${t("Supplier")} <span class="opt-label">${t("(optional)")}</span></label>
            <input id="pVendor" class="input" list="vendorList" autocomplete="off" placeholder="${t("e.g. Merkato Fresh Produce")}" value="${esc(d.vendor)}" data-bind="purchase.vendor">
            <datalist id="vendorList">${vendors().map((v) => `<option value="${esc(v)}">`).join("")}</datalist></div>
          <div class="field"><label for="pDate">${t("Date")}</label><input id="pDate" class="input" type="date" max="${today()}" value="${esc(d.date)}" data-bind="purchase.date"></div>
        </div>
        <div class="field"><span class="label" id="pMethodLbl">${t("Paid with")}</span>${methodGrid("p-method", d.method, EXPENSE_METHODS, "pMethodLbl")}</div>
        <div class="field"><label for="pNote">${t("Note")} <span class="opt-label">${t("(optional)")}</span></label>
          <input id="pNote" class="input" type="text" placeholder="${t("e.g. quality issue, who delivered")}" value="${esc(d.note)}" data-bind="purchase.note"></div>
        <div class="total-bar">
          <div><span class="label">${t("Purchase total")}</span><output id="pSum" aria-live="polite">${money(parseAmount(d.total) || 0, 2)}</output>
            <small class="stamp">${icon("user")} ${t("Will be logged by {name}", { name: esc(user().name) })}</small></div>
          <div class="form-actions">
            <button type="button" class="btn" data-action="save-purchase" data-another="1">${t("Save & add another")}</button>
            <button type="submit" class="btn primary">${icon("check")} ${t("Save purchase")}</button>
          </div>
        </div>
      </form>
      <aside class="side" id="boughtSide">${boughtSide()}</aside>
    </div>`;
}

/* ---------- what was bought ---------- */

function boughtSide(): string {
  const all = db.purchases.filter((p) => inPeriod(p.timestamp));
  const byMain = new Map<MainCategory, number>();
  for (const p of all) {
    const m = inventoryItem(p.itemId)?.main;
    if (m) byMain.set(m, (byMain.get(m) ?? 0) + p.totalCost);
  }
  const total = all.reduce((s, p) => s + p.totalCost, 0);
  const rows = all.filter((p) => state.boughtFilter === "ALL" || inventoryItem(p.itemId)?.main === state.boughtFilter)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const shown = rows.slice(0, state.boughtLimit);
  const shownTotal = rows.reduce((s, p) => s + p.totalCost, 0);
  let lastDay = "";
  const list = shown.map((p) => {
    const day = localDay(p.timestamp);
    const head = day !== lastDay ? `<li class="day-head">${esc(relDay(day))} <span class="meta">${esc(fmtDay(day))}</span></li>` : "";
    lastDay = day;
    const m = inventoryItem(p.itemId)?.main;
    return `${head}<li class="entry row-hover"><strong>${m ? dot(m) : ""}${esc(tk(p.itemName))}</strong><span class="num">${money(p.totalCost)}</span>
      <div class="entry-meta"><span>${num(p.quantity)} ${esc(tk(`unit.${p.unit}`))} × ${money(p.unitCost)} · ${esc(payName(p.paymentMethod))}${p.vendor ? ` · ${esc(p.vendor)}` : ""}</span>
        ${canDelete() ? `<button type="button" class="btn ghost small icon-btn" data-action="delete-purchase" data-value="${p.id}" aria-label="${t("Delete {x}", { x: tk(p.itemName) })}">${icon("trash")}</button>` : ""}</div>
      <div class="entry-meta">${byline(p.loggedBy, p.timestamp)}</div></li>`;
  }).join("");
  const present = MAIN_IDS.filter((m) => byMain.get(m));
  return `
    <section class="card">
      <div class="card-head"><div><h2>${t("What we bought")}</h2><p>${t("{n} entries", { n: all.length })} · ${money(total, 0)}</p></div></div>
      <div class="bar-list">${present.sort((a, b) => (byMain.get(b) ?? 0) - (byMain.get(a) ?? 0)).map((m) => `
        <div class="bar-row static"><span>${dot(m)}${esc(mainName(m))}</span><span class="num">${money(byMain.get(m) ?? 0, 0)}</span>
          <span class="bar-track"><i style="width:${total ? ((byMain.get(m) ?? 0) / total) * 100 : 0}%;background:${MAIN_COLOR[m]}"></i></span></div>`).join("") ||
        `<div class="empty"><strong>${t("No purchases in this period")}</strong></div>`}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>${t("Purchase history")}</h2><p>${t("{n} entries", { n: rows.length })} · ${money(shownTotal, 0)}</p></div></div>
      <div class="seg small wrap filter-seg" role="group" aria-label="${t("Filter by main category")}">
        <button type="button" data-action="bought-filter" data-value="ALL" aria-pressed="${state.boughtFilter === "ALL"}">${t("All")}</button>
        ${present.map((m) => `<button type="button" data-action="bought-filter" data-value="${m}" aria-pressed="${state.boughtFilter === m}">${esc(mainName(m))}</button>`).join("")}
      </div>
      ${rows.length ? `<ul class="entry-list">${list}</ul>
        ${rows.length > shown.length ? `<button type="button" class="btn small more" data-action="bought-more">${t("Show more ({n} left)", { n: rows.length - shown.length })}</button>` : ""}`
        : `<div class="empty"><strong>${t("Nothing bought in this period")}</strong></div>`}
    </section>`;
}

/* ---------- live behaviour ---------- */

function recalc(): void {
  const q = parseAmount(d.quantity), c = parseAmount(d.unitCost), tot = parseAmount(d.total);
  if (d.lastEdited === "cost") {
    d.total = q > 0 && c >= 0 ? plain(q * c) : "";
    const el = $<HTMLInputElement>("#pTotal");
    if (el && document.activeElement !== el) el.value = d.total;
  } else if (q > 0 && tot >= 0) {
    d.unitCost = plain(tot / q);
    const el = $<HTMLInputElement>("#pCost");
    if (el && document.activeElement !== el) el.value = d.unitCost;
  }
  const sum = $("#pSum");
  if (sum) sum.textContent = money(parseAmount(d.total) || 0, 2);
  if (parseAmount(d.total) > 0) clearErrors(["total"]);
}

/** Redraw just the item block (keeps what's typed in the other fields). */
function refreshItem(focus?: string): void {
  const area = $("#pItemArea");
  if (area) area.innerHTML = itemArea(state.errors);
  const unit = $<HTMLSelectElement>("#pUnit");
  if (unit) unit.value = d.unit;
  const cost = $<HTMLInputElement>("#pCost");
  if (cost) cost.value = d.unitCost;
  const vendor = $<HTMLInputElement>("#pVendor");
  if (vendor && !vendor.value) vendor.value = d.vendor;
  mountSearch();
  recalc();
  if (focus) $<HTMLElement>(focus)?.focus();
}

function pick(item: InventoryItem): void {
  d.itemId = item.id;
  d.creating = false;
  d.newName = "";
  d.search = "";
  d.unit = item.unit;
  d.unitCost = plain(lastCost(item.id) ?? item.unitCost);
  d.lastEdited = "cost";
  const last = db.purchases.filter((p) => p.itemId === item.id).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  if (!d.vendor && last?.vendor && last.vendor !== "Unknown vendor") d.vendor = last.vendor;
  clearErrors(["main", "item"]);
  refreshItem("#pQty");
}

function startNew(name: string, main: MainCategory | "" = ""): void {
  const existing = itemNamed(name);
  if (existing) return pick(existing);           // it's already in the list — use it, no duplicate
  d.itemId = null;
  d.creating = true;
  d.newName = tidyName(name);
  d.newMain = main;
  d.search = "";
  clearErrors(["main", "item"]);
  refreshItem(d.newName ? (main ? "#pQty" : '[data-action="p-new-main"]') : "#pNewName");
}

/** Adds the typed item to the shared catalog (saved to the server, reused from then on). */
function createItem(name: string, main: MainCategory): InventoryItem {
  const id = newId("inv");
  const nameKey = `inv.${id}`;
  registerText(nameKey, { en: name, am: "", om: "" });
  const item: InventoryItem = {
    id, nameKey, category: MAIN_TO_COGS[main], main, groupKey: `main.${main}`, unit: d.unit,
    unitCost: round2(parseAmount(d.unitCost) || 0), aliases: [], custom: true,
  };
  db.customInventory.push(item);
  recordItem(item, name);
  return item;
}

function mountSearch(): void {
  const input = $<HTMLInputElement>("#pSearch");
  const list = $<HTMLUListElement>("#pSearchList");
  if (input && list) attachCombobox(input, list, source, (o) => ("create" in o.value ? startNew(o.value.create) : pick(o.value)));
}

export function mountPurchases(): void {
  mountSearch();
  recalc();
}

export function onPurchaseInput(key: string, value: string): void {
  if (key === "search") { d.search = value; clearErrors(["item"]); }
  else if (key === "newName") { d.newName = value; clearErrors(["item"]); }
  else if (key === "quantity") { d.quantity = value; clearErrors(["qty"]); recalc(); }
  else if (key === "unitCost") { d.unitCost = value; d.lastEdited = "cost"; clearErrors(["total"]); recalc(); }
  else if (key === "total") { d.total = value; d.lastEdited = "total"; clearErrors(["total"]); recalc(); }
  else if (key === "vendor") d.vendor = value;
  else if (key === "date") d.date = value;
  else if (key === "note") d.note = value;
  else if (key === "unit") d.unit = value;
}

function save(another: boolean): void {
  const q = parseAmount(d.quantity), tot = parseAmount(d.total);
  const errors: FieldErrors = {};
  if (!d.itemId && !d.creating) {
    // typed a name but didn't pick from the list: use the matching item, or offer to add it
    const typed = d.search.trim();
    const match = typed ? itemNamed(typed) : undefined;
    if (match) { d.itemId = match.id; d.search = ""; }   // keep the quantity and price they typed
    else if (typed) { startNew(typed); errors.main = t("Choose a group for the new item."); }
    else errors.item = t("Search for the item you bought.");
  } else if (d.creating) {
    if (!d.newName.trim()) errors.item = t("Type the new item's name.");
    else if (!d.newMain) errors.main = t("Choose a group for the new item.");
  }
  if (!(q > 0)) errors.qty = t("Enter a quantity above 0.");
  if (!(tot > 0)) errors.total = t("Enter a unit cost or the total.");
  if (showErrors(errors, ["item", "main", "qty", "total"])) {
    if (errors.item) $<HTMLElement>("#pSearch, #pNewName")?.focus();
    else if (errors.main) $<HTMLElement>('[data-action="p-new-main"]')?.focus();
    return;
  }
  let item = d.itemId ? inventoryItem(d.itemId) : itemNamed(d.newName);
  const created = !item;
  if (!item) item = createItem(tidyName(d.newName), d.newMain as MainCategory);
  const ts = d.date === today() ? new Date().toISOString() : stamp(d.date, 12);
  const { loggedBy, userId } = stampUser();
  const rec: PurchaseRecord = {
    id: newId("pur"), category: item.category, itemName: item.nameKey, quantity: q, unit: d.unit,
    unitCost: round2(tot / q), totalCost: round2(tot), loggedBy, timestamp: ts,
    itemId: item.id, vendor: d.vendor.trim(), paymentMethod: d.method, userId, note: d.note.trim(),
  };
  recordPurchase(rec);
  item.unitCost = rec.unitCost;
  d = another ? fresh({ vendor: d.vendor, date: d.date, method: d.method }) : fresh({ method: d.method });
  state.errors = {};
  rerender("#pSearch");
  const savedItem = item;
  toast(t("Saved {item} · {q} {u} · {x} · by {name}", { item: tk(savedItem.nameKey), q: num(q), u: tk(`unit.${rec.unit}`), x: money(rec.totalCost, 2), name: loggedBy }) +
    (created ? ` · ${t("added to your items")}` : ""), () => {
    removeRecord("PURCHASE", rec.id);
    if (created) db.customInventory = db.customInventory.filter((i) => i !== savedItem);
    rerender();
  });
}

export const submitPurchase = (): void => save(false);

export const purchaseActions: ActionMap = {
  "save-purchase": (el) => save(Boolean(el.dataset.another)),
  "p-clear": () => {
    d.itemId = null; d.creating = false; d.newName = ""; d.newMain = ""; d.search = "";
    clearErrors(["main", "item"]);
    refreshItem("#pSearch");
  },
  "p-main": (el) => {
    const v = el.dataset.value ?? "";
    if (!isMain(v)) return;
    d.browseMain = d.browseMain === v ? "" : v;
    refreshItem(`[data-action="p-main"][data-value="${v}"]`);
  },
  "p-item": (el) => {
    const item = inventoryItem(el.dataset.value ?? "");
    if (item) pick(item);
  },
  "p-new": (el) => {
    const v = el.dataset.value ?? "";
    d.itemId = null; d.creating = true; d.newName = ""; d.newMain = isMain(v) ? v : "";
    clearErrors(["item", "main"]);
    refreshItem("#pNewName");
  },
  "p-new-main": (el) => {
    const v = el.dataset.value ?? "";
    if (!isMain(v)) return;
    d.newMain = v;
    clearErrors(["main"]);
    document.querySelectorAll<HTMLElement>('[data-action="p-new-main"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    $<HTMLElement>(d.newName.trim() ? "#pQty" : "#pNewName")?.focus();
  },
  "p-method": (el) => { const v = el.dataset.value ?? ""; if (isExpenseMethod(v)) { d.method = v; setPressed(el); } },
  "bought-filter": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.boughtFilter = v === "ALL" || isMain(v) ? v : "ALL";
    state.boughtLimit = 20;
    const side = $("#boughtSide");
    if (side) side.innerHTML = boughtSide();
    $<HTMLElement>(`[data-action="bought-filter"][data-value="${state.boughtFilter}"]`)?.focus();
  },
  "bought-more": () => {
    state.boughtLimit += 20;
    const side = $("#boughtSide");
    if (side) side.innerHTML = boughtSide();
  },
  "delete-purchase": (el) => {
    const removed = removeRecord("PURCHASE", el.dataset.value ?? "");
    if (!removed) return;
    rerender();
    toast(t("Deleted by {name}", { name: user().name }), () => { restoreRecord(removed); rerender(); });
  },
};
