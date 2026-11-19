/* Restock minimums: for each stock item, the amount at or below which it
   shows up as low stock. The manager types any value (0 turns the alert off
   for that item) and saves the changed ones together. */

import { t, tk, tkAll } from "../i18n";
import { normalize, parseAmount, plain } from "../format";
import { db, setMinimums, user } from "../store";
import { $, esc, icon } from "../ui/dom";
import { qtyUnit, unitName } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender } from "../ui/app";

let drafts = new Map<string, string>();
let query = "";
let error = "";

export function freshMinimums(): void { drafts = new Map(); query = ""; error = ""; }

const changed = (): { itemId: string; minimum: number }[] => {
  const out: { itemId: string; minimum: number }[] = [];
  for (const [id, v] of drafts) {
    const it = db.inventory.find((i) => i.id === id);
    const n = parseAmount(v);
    if (it && v.trim() !== "" && Number.isFinite(n) && n >= 0 && n !== it.reorderPoint) out.push({ itemId: id, minimum: n });
  }
  return out;
};

function rows(): string {
  const q = normalize(query.trim());
  const list = db.inventory
    .filter((i) => !q || [...tkAll(i.nameKey), ...i.aliases].some((x) => normalize(x).includes(q)))
    .sort((a, b) => tk(a.nameKey).localeCompare(tk(b.nameKey)));
  if (!list.length) return `<p class="meta">${t("No item matches “{q}”.", { q: esc(query) })}</p>`;
  return `<ul class="min-list">${list.map((i) => {
    const v = drafts.get(i.id) ?? plain(i.reorderPoint);
    const low = i.currentQuantity <= (parseAmount(v) || 0);
    return `<li class="min-row${drafts.has(i.id) && parseAmount(v) !== i.reorderPoint ? " edited" : ""}">
      <span class="rs-name"><strong>${esc(tk(i.nameKey))}</strong>
        <small>${t("{q} in stock", { q: qtyUnit(i.currentQuantity, i.unit) })}${low && parseAmount(v) > 0 ? ` · <span class="bad-text">${t("low")}</span>` : ""}</small></span>
      <div class="affix right rs-qty"><input class="input num-in" inputmode="decimal" autocomplete="off" data-min="${esc(i.id)}"
        aria-label="${t("Restock minimum for {item}", { item: tk(i.nameKey) })}" value="${esc(v)}"><span>${esc(unitName(i.unit))}</span></div>
    </li>`;
  }).join("")}</ul>`;
}

function saveLabel(): string {
  const n = changed().length;
  return `${icon("check")} ${n === 1 ? t("Save 1 change") : n ? t("Save {n} changes", { n }) : t("Save")}`;
}

export function minimumsForm(): string {
  return `
    <form id="minimumsForm" class="form" novalidate>
      <p class="meta">${t("An item shows as low stock when it is at or below its minimum. Type any amount; 0 turns the alert off for that item.")}</p>
      <div class="field"><label for="minSearch">${t("Find an item")}</label>
        <input id="minSearch" class="input" type="search" autocomplete="off" value="${esc(query)}" placeholder="${t("Search stock, e.g. “tom” for Tomato")}"></div>
      <div id="minRows">${rows()}</div>
      <p class="err" id="err-min" role="alert">${esc(error)}</p>
      <div class="modal-foot">
        <small class="stamp">${icon("user")} ${t("Changes are saved by {name} ({id})", { name: esc(user().name), id: esc(user().userId) })}</small>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
          <button type="submit" class="btn primary" id="minSave">${saveLabel()}</button></div>
      </div>
    </form>`;
}

export function mountMinimums(): void {
  $<HTMLInputElement>("#minSearch")?.focus();
}

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "minSearch") {
    query = el.value;
    const box = $("#minRows"); if (box) box.innerHTML = rows();
    return;
  }
  const id = el.dataset?.min;
  if (!id) return;
  drafts.set(id, el.value);
  const it = db.inventory.find((i) => i.id === id);
  el.closest(".min-row")?.classList.toggle("edited", !!it && parseAmount(el.value) !== it.reorderPoint);
  if (error) { error = ""; const err = $("#err-min"); if (err) err.textContent = ""; }
  const b = $("#minSave"); if (b) b.innerHTML = saveLabel();
});

export function submitMinimums(close: () => void): void {
  for (const [id, v] of drafts) {
    const n = parseAmount(v);
    if (v.trim() === "" || !Number.isFinite(n) || n < 0) {
      const it = db.inventory.find((i) => i.id === id);
      error = t("Enter a number (0 or more) for {item}.", { item: tk(it?.nameKey ?? id) });
      const err = $("#err-min"); if (err) err.textContent = error;
      $<HTMLInputElement>(`[data-min="${CSS.escape(id)}"]`)?.focus();
      return;
    }
  }
  const list = changed();
  close();
  if (!list.length) { rerender(); return; }
  setMinimums(list);
  rerender();
  toast(list.length === 1
    ? t("Minimum for {item} set to {q}", { item: tk(db.inventory.find((i) => i.id === list[0].itemId)?.nameKey ?? ""), q: qtyUnit(list[0].minimum, db.inventory.find((i) => i.id === list[0].itemId)?.unit ?? "") })
    : t("Saved {n} restock minimums", { n: list.length }));
}
