/* Purchases (buying only). Pick a main category (e.g. Vegetables), then
   the item (e.g. Onion) — or search any item directly. Quantity × unit
   cost with a two-way total, vendor, and how it was paid (Cash, Telebirr,
   CBE). The history below shows everything that was bought and by whom. */

import type { FieldErrors, InventoryItem, MainCategory, PurchaseRecord } from "../types";
import { registerText, t, tk, tkAll } from "../i18n";
import { localDay, money, normalize, num, parseAmount, plain, relDay, round2, stamp, today, fmtDay } from "../format";
import { EXPENSE_METHODS, MAIN_COLOR, MAIN_IDS, MAIN_TO_COGS, UNIT_CODES, isExpenseMethod, isMain } from "../catalog";
import { newId } from "../seed";
import {
  canDelete, db, inPeriod, inventory, inventoryItem, lastCost, recordPurchase, removeRecord, restoreRecord, state, stampUser, user, vendors,
} from "../store";
import { $, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboOption } from "../ui/combobox";
import { byline, clearErrors, errText, invalid, methodGrid, metricsBar, payName, periodSeg, setPressed, showErrors } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Draft {
  main: MainCategory | "";
  itemId: string | null;
  /** typing a brand-new item */
  creating: boolean;
  newName: string;
  search: string;
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
  main: keep.main ?? "", itemId: null, creating: false, newName: "", search: "", quantity: "", unit: "kg", unitCost: "", total: "", lastEdited: "cost",
  vendor: keep.vendor ?? "", date: keep.date ?? today(), method: keep.method ?? "CASH", note: "",
});

let d: Draft = fresh();

const mainName = (m: MainCategory): string => tk(`main.${m}`);
const dot = (m: MainCategory): string => `<i class="dot" style="background:${MAIN_COLOR[m]}"></i>`;

/* ---------- search (shortcut across all items) ---------- */

function rank(query: string): { item: InventoryItem; start: number }[] {
  const q = normalize(query);
  if (!q) return [];
  const out: { item: InventoryItem; score: number; start: number }[] = [];
  for (const item of inventory()) {
    let best = -1;
    let start = -1;
    for (const text of [...tkAll(item.nameKey), ...item.aliases]) {
      const n = normalize(text);
      const i = n.indexOf(q);
      const score = n.startsWith(q) ? 100 : i >= 0 && /[\s(-]/.test(n[i - 1] ?? "") ? 90 : i >= 0 ? 70 : -1;
      if (score > best) { best = score; start = text === tk(item.nameKey) ? i : -1; }
    }
    if (best > 0) out.push({ item, score: best, start });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

function source(query: string): { heading: string; options: ComboOption<InventoryItem>[] } {
  const q = query.trim();
  const ranked = q ? rank(q) : [];
  const options: ComboOption<InventoryItem>[] = ranked.map(({ item, start }) => {
    const name = tk(item.nameKey);
    return {
      value: item,
      html: `<span class="opt-main"><span class="opt-name">${start >= 0 ? highlight(name, start, q.length) : esc(name)}</span>
        <span class="opt-crumb">${dot(item.main)}${esc(mainName(item.main))}</span></span>
        <span class="opt-side"><span class="mono">${money(lastCost(item.id) ?? item.unitCost)}/${esc(tk(`unit.${item.unit}`))}</span></span>`,
    };
  });
  return { heading: ranked.length ? t("Stock items") : "", options };
}

/* ---------- form ---------- */

function itemPicker(e: FieldErrors): string {
  if (!d.main) return `<p class="hint">${t("Choose a main category first.")}</p>`;
  const items = inventory().filter((i) => i.main === d.main).sort((a, b) => tk(a.nameKey).localeCompare(tk(b.nameKey)));
  return `
    <div class="chip-grid items" role="group" aria-labelledby="pItemLbl">
      ${items.map((i) => `<button type="button" class="pick-chip" data-action="p-item" data-value="${i.id}" aria-pressed="${d.itemId === i.id}">${esc(tk(i.nameKey))}</button>`).join("")}
      <button type="button" class="pick-chip add" data-action="p-new" aria-pressed="${d.creating}">${icon("plus")} ${t("Other item")}</button>
    </div>
    ${d.creating ? `<div class="field new-item"><label for="pNewName">${t("New item name")}</label>
      <input id="pNewName" class="input" autocomplete="off" placeholder="${t("e.g. Carrot")}" value="${esc(d.newName)}" data-bind="purchase.newName" ${invalid(e, "item")}>
      <p class="hint">${t("It will be added under {c}.", { c: esc(mainName(d.main)) })}</p></div>` : ""}
    ${errText(e, "item")}`;
}

function selectionLine(): string {
  if (!d.main) return "";
  const item = d.itemId ? inventoryItem(d.itemId) : undefined;
  const name = item ? tk(item.nameKey) : d.creating && d.newName.trim() ? d.newName.trim() : "";
  return `<p class="pick-summary">${dot(d.main)}<strong>${esc(mainName(d.main))}</strong>${name ? ` › <strong>${esc(name)}</strong>` : ""}
    <span class="meta"> · ${t("booked as {c}", { c: esc(tk(`cogs.${MAIN_TO_COGS[d.main]}`)) })}</span></p>`;
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
        <div class="field">
          <label for="pSearch">${t("Quick search")} <span class="opt-label">${t("(optional)")}</span></label>
          <div class="combo">
            <input id="pSearch" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="pSearchList"
              autocomplete="off" placeholder="${t("Type to search, e.g. “on” for Onion")}" value="${esc(d.search)}" data-bind="purchase.search">
            <ul id="pSearchList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
          </div>
        </div>
        <div class="field"><span class="label" id="pMainLbl">${t("1. Main category")}</span>
          <div class="chip-grid mains" role="group" aria-labelledby="pMainLbl">${MAIN_IDS.map((m) =>
            `<button type="button" class="pick-chip cat" data-action="p-main" data-value="${m}" aria-pressed="${d.main === m}">${dot(m)}${esc(mainName(m))}</button>`).join("")}</div>
          ${errText(e, "main")}</div>
        <div class="field"><span class="label" id="pItemLbl">${t("2. Item")}</span>
          <div id="pItemPicker">${itemPicker(e)}</div>
          <div id="pPickSummary">${selectionLine()}</div></div>
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
        <p class="hint">${t("Type the unit cost or the receipt total; the other is calculated.")}</p>
        <div class="row">
          <div class="field"><label for="pVendor">${t("Vendor")} <span class="opt-label">${t("(optional)")}</span></label>
            <input id="pVendor" class="input" list="vendorList" autocomplete="off" placeholder="${t("e.g. Merkato Fresh Produce")}" value="${esc(d.vendor)}" data-bind="purchase.vendor">
            <datalist id="vendorList">${vendors().map((v) => `<option value="${esc(v)}">`).join("")}</datalist></div>
          <div class="field"><label for="pDate">${t("Date")}</label><input id="pDate" class="input" type="date" max="${today()}" value="${esc(d.date)}" data-bind="purchase.date"></div>
        </div>
        <div class="field"><span class="label" id="pMethodLbl">${t("Paid with")}</span>${methodGrid("p-method", d.method, EXPENSE_METHODS, "pMethodLbl")}</div>
        <div class="field"><label for="pNote">${t("Note")} <span class="opt-label">${t("(optional)")}</span></label>
          <input id="pNote" class="input" type="text" placeholder="${t("e.g. receipt no., quality issue")}" value="${esc(d.note)}" data-bind="purchase.note"></div>
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

const refreshPicker = (focus?: string): void => {
  const ip = $("#pItemPicker");
  if (ip) ip.innerHTML = itemPicker(state.errors);
  const ps = $("#pPickSummary");
  if (ps) ps.innerHTML = selectionLine();
  document.querySelectorAll<HTMLElement>('[data-action="p-main"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === d.main)));
  if (focus) $<HTMLElement>(focus)?.focus();
};

function pick(item: InventoryItem): void {
  d.main = item.main;
  d.itemId = item.id;
  d.creating = false;
  d.newName = "";
  d.search = "";
  d.unit = item.unit;
  d.unitCost = plain(lastCost(item.id) ?? item.unitCost);
  d.lastEdited = "cost";
  const last = db.purchases.filter((p) => p.itemId === item.id).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  if (!d.vendor && last?.vendor) d.vendor = last.vendor;
  clearErrors(["main", "item"]);
  rerender("#pQty");
}

/** Creates a stock item from the typed name, filed under the chosen main category. */
function createItem(name: string, main: MainCategory): InventoryItem {
  const id = newId("inv");
  const nameKey = `inv.${id}`;
  registerText(nameKey, { en: name, am: "", om: "" });
  const item: InventoryItem = {
    id, nameKey, category: MAIN_TO_COGS[main], main, groupKey: `main.${main}`, unit: d.unit,
    unitCost: round2(parseAmount(d.unitCost) || 0), aliases: [], custom: true,
  };
  db.customInventory.push(item);
  return item;
}

export function mountPurchases(): void {
  const input = $<HTMLInputElement>("#pSearch");
  const list = $<HTMLUListElement>("#pSearchList");
  if (input && list) attachCombobox(input, list, source, (o) => pick(o.value));
  recalc();
}

export function onPurchaseInput(key: string, value: string): void {
  if (key === "search") d.search = value;
  else if (key === "newName") {
    d.newName = value;
    clearErrors(["item"]);
    const ps = $("#pPickSummary");
    if (ps) ps.innerHTML = selectionLine();
  } else if (key === "quantity") { d.quantity = value; clearErrors(["qty"]); recalc(); }
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
  if (!d.main) errors.main = t("Choose a main category.");
  else if (!d.itemId && !(d.creating && d.newName.trim())) errors.item = d.creating ? t("Type the new item's name.") : t("Choose the item you bought.");
  if (!(q > 0)) errors.qty = t("Enter a quantity above 0.");
  if (!(tot > 0)) errors.total = t("Enter a unit cost or the total.");
  if (showErrors(errors, ["main", "item", "qty", "total"])) {
    if (errors.main) $<HTMLElement>('[data-action="p-main"]')?.focus();
    else if (errors.item && !d.creating) $<HTMLElement>('[data-action="p-item"]')?.focus();
    return;
  }
  const main = d.main as MainCategory;
  let item = d.itemId ? inventoryItem(d.itemId) : inventory().find((i) => i.main === main && normalize(tk(i.nameKey)) === normalize(d.newName));
  const created = !item;
  if (!item) item = createItem(d.newName.trim(), main);
  const ts = d.date === today() ? new Date().toISOString() : stamp(d.date, 12);
  const { loggedBy, userId } = stampUser();
  const rec: PurchaseRecord = {
    id: newId("pur"), category: item.category, itemName: item.nameKey, quantity: q, unit: d.unit,
    unitCost: round2(tot / q), totalCost: round2(tot), loggedBy, timestamp: ts,
    itemId: item.id, vendor: d.vendor.trim(), paymentMethod: d.method, userId, note: d.note.trim(),
  };
  recordPurchase(rec);
  item.unitCost = rec.unitCost;
  d = another ? fresh({ main, vendor: d.vendor, date: d.date, method: d.method }) : fresh();
  state.errors = {};
  rerender(another ? '[data-action="p-item"]' : '[data-action="p-main"]');
  toast(t("Saved {item} · {q} {u} · {x} · by {name}", { item: tk(item.nameKey), q: num(q), u: tk(`unit.${rec.unit}`), x: money(rec.totalCost, 2), name: loggedBy }) +
    (created ? ` · ${t("new item added")}` : ""), () => {
    removeRecord("PURCHASE", rec.id);
    if (created) db.customInventory = db.customInventory.filter((i) => i !== item);
    rerender();
  });
}

export const submitPurchase = (): void => save(false);

export const purchaseActions: ActionMap = {
  "save-purchase": (el) => save(Boolean(el.dataset.another)),
  "p-main": (el) => {
    const v = el.dataset.value ?? "";
    if (!isMain(v)) return;
    if (d.main !== v) { d.main = v; d.itemId = null; d.creating = false; d.newName = ""; }
    clearErrors(["main", "item"]);
    refreshPicker('[data-action="p-item"]');
  },
  "p-item": (el) => {
    const item = inventoryItem(el.dataset.value ?? "");
    if (item) pick(item);
  },
  "p-new": () => {
    d.itemId = null;
    d.creating = true;
    clearErrors(["item"]);
    refreshPicker("#pNewName");
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
