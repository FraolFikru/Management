/* Dialogs: "Log waste" form, "Reject with reason" for dispatches and
   "Flag purchase". One open at a time, focus is trapped inside and
   returned to the button that opened it; Escape closes. */

import type { FieldErrors, InventoryItem, WasteReason } from "../types";
import { t, tk, tkAll } from "../i18n";
import { money, normalize, parseAmount, plain, round2 } from "../format";
import { NOTE_REQUIRED, REJECT_REASONS, STAFF, WASTE_COLOR, WASTE_IDS, isWasteReason } from "../catalog";
import { db, flagPurchase, item, logWaste, rejectDispatch, removeWaste, reopenDispatch, reopenPurchase, state, user, type Modal } from "../store";
import { $, $$, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboOption } from "../ui/combobox";
import { clearErrors, dot, errText, invalid, qtyUnit, roleName, showErrors, stampOf, unitName } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

const FLAG_REASONS: readonly string[] = ["Price higher than last week", "Receipt missing", "Quantity does not match delivery note", "Wrong item delivered"];

let opener: HTMLElement | null = null;

interface WasteDraft { itemId: string | null; query: string; qty: string; value: string; valueEdited: boolean; reason: WasteReason | ""; notes: string; reporter: string }
let w: WasteDraft = freshWaste();
function freshWaste(): WasteDraft {
  return { itemId: null, query: "", qty: "", value: "", valueEdited: false, reason: "", notes: "", reporter: state.userId };
}
let reason = "";
let reasonText = "";

export function openModal(m: Exclude<Modal, null>, from: HTMLElement): void {
  opener = from;
  state.modal = m;
  state.errors = {};
  if (m.kind === "waste") w = freshWaste();
  reason = "";
  reasonText = "";
  renderModal();
}

export function closeModal(): void {
  state.modal = null;
  state.errors = {};
  const root = $("#modalRoot");
  if (root) root.innerHTML = "";
  document.body.classList.remove("modal-open");
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

/* ---------- waste form ---------- */

function rank(query: string): InventoryItem[] {
  const q = normalize(query);
  if (!q) return [];
  return db.inventory
    .map((i) => {
      const texts = [...tkAll(i.nameKey), ...i.aliases].map(normalize);
      const score = texts.some((x) => x.startsWith(q)) ? 2 : texts.some((x) => x.includes(q)) ? 1 : 0;
      return { i, score };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.i);
}

function source(query: string): { heading: string; options: ComboOption<InventoryItem>[] } {
  const list = rank(query);
  const q = query.trim();
  return {
    heading: list.length ? t("Stock items") : "",
    options: list.map((i) => {
      const name = tk(i.nameKey);
      const at = normalize(name).indexOf(normalize(q));
      return {
        value: i,
        html: `<span class="opt-main"><span class="opt-name">${at >= 0 ? highlight(name, at, q.length) : esc(name)}</span>
          <span class="opt-crumb">${esc(tk(`cogs.${i.category}`))}</span></span>
          <span class="opt-side"><span class="mono">${t("{q} in stock", { q: qtyUnit(i.currentQuantity, i.unit) })}</span></span>`,
      };
    }),
  };
}

function wasteForm(): string {
  const e: FieldErrors = state.errors;
  const it = w.itemId ? item(w.itemId) : undefined;
  const needsNote = w.reason !== "" && NOTE_REQUIRED.has(w.reason);
  return `
    <form id="wasteForm" class="form" novalidate>
      <div class="field"><label for="wItem">${t("Item")}</label>
        <div class="combo">
          <input id="wItem" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wItemList"
            autocomplete="off" placeholder="${t("Search stock, e.g. “tom” for Tomato")}" value="${esc(it ? tk(it.nameKey) : w.query)}" data-bind="waste.query" ${invalid(e, "item")}>
          <ul id="wItemList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
        </div>
        ${it ? `<p class="hint">${t("{q} in stock · cost {c} per {u}", { q: qtyUnit(it.currentQuantity, it.unit), c: money(it.unitCost, 2), u: unitName(it.unit) })}</p>` : ""}
        ${errText(e, "item")}</div>
      <div class="row">
        <div class="field"><label for="wQty">${t("Quantity Lost")}</label>
          <div class="affix right"><input id="wQty" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(w.qty)}" data-bind="waste.qty" ${invalid(e, "qty")}><span>${it ? esc(unitName(it.unit)) : ""}</span></div>
          ${errText(e, "qty")}</div>
        <div class="field"><label for="wValue">${t("Loss value")}</label>
          <div class="affix"><span>ETB</span><input id="wValue" class="input num-in" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(w.value)}" data-bind="waste.value" ${invalid(e, "value")}></div>
          <p class="hint">${t("Calculated from stock cost; you can change it.")}</p>${errText(e, "value")}</div>
      </div>
      <div class="field"><span class="label" id="wReasonLbl">${t("Reason")}</span>
        <div class="reason-grid" role="group" aria-labelledby="wReasonLbl">${WASTE_IDS.map((r) =>
          `<button type="button" class="reason-opt" data-action="w-reason" data-value="${r}" aria-pressed="${w.reason === r}">${dot(WASTE_COLOR[r])}${esc(tk(`waste.${r}`))}</button>`).join("")}</div>
        ${errText(e, "reason")}</div>
      <div class="field"><label for="wNotes">${t("Notes")} <span class="opt-label">${needsNote ? t("(required)") : t("(optional)")}</span></label>
        <textarea id="wNotes" class="input" rows="2" placeholder="${t("What happened?")}" data-bind="waste.notes" ${invalid(e, "notes")}>${esc(w.notes)}</textarea>${errText(e, "notes")}</div>
      <div class="field"><label for="wReporter">${t("Reporting Staff ID")}</label>
        <select id="wReporter" class="input" data-bind="waste.reporter">${STAFF.map((s) =>
          `<option value="${s.userId}" ${s.userId === w.reporter ? "selected" : ""}>${esc(s.userId)} · ${esc(s.name)} (${esc(roleName(s.role))})</option>`).join("")}</select></div>
      <div class="modal-foot">
        <small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().name), id: esc(user().userId) })}</small>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
          <button type="submit" class="btn primary">${icon("check")} ${t("Log waste")}</button></div>
      </div>
    </form>`;
}

/* ---------- reason dialogs ---------- */

function reasonForm(kind: "reject" | "flag", id: string): string {
  const e: FieldErrors = state.errors;
  let summary = "";
  if (kind === "reject") {
    const d = db.dispatches.find((x) => x.id === id);
    if (d) summary = `<strong>${esc(tk(d.itemName))}</strong> · ${qtyUnit(d.quantity, d.unit)} → ${esc(tk(`dest.${d.destination}`))}<br>${stampOf(d.requestedBy, d.timestamp, t("Requested by"))}`;
  } else {
    const p = db.purchases.find((x) => x.id === id);
    const it = p ? item(p.itemId) : undefined;
    if (p && it) summary = `<strong>${esc(tk(it.nameKey))}</strong> · ${qtyUnit(p.quantity, p.unit)} · ${money(p.totalCost, 0)} · ${esc(p.vendor)}<br>${stampOf(p.loggedBy, p.timestamp, t("Logged by"))}`;
  }
  const options = kind === "reject" ? REJECT_REASONS : FLAG_REASONS;
  return `
    <form id="reasonForm" class="form" novalidate>
      <p class="modal-summary">${summary}</p>
      <div class="field"><span class="label" id="rLbl">${t("Reason")}</span>
        <div class="reason-grid one" role="group" aria-labelledby="rLbl">${options.map((r) =>
          `<button type="button" class="reason-opt" data-action="r-pick" data-value="${esc(r)}" aria-pressed="${reason === r}">${esc(t(r))}</button>`).join("")}</div></div>
      <div class="field"><label for="rText">${t("Or write the reason")}</label>
        <textarea id="rText" class="input" rows="2" data-bind="reason.text" placeholder="${t("Explain so the sales team knows what to do")}" ${invalid(e, "reason")}>${esc(reasonText)}</textarea>${errText(e, "reason")}</div>
      <div class="modal-foot">
        <small class="stamp">${icon("user")} ${t("Decision will be stamped {name} ({id})", { name: esc(user().name), id: esc(user().userId) })}</small>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
          <button type="submit" class="btn danger">${kind === "reject" ? `${icon("x")} ${t("Reject dispatch")}` : `${icon("flag")} ${t("Flag purchase")}`}</button></div>
      </div>
    </form>`;
}

export function renderModal(): void {
  const root = $("#modalRoot");
  const m = state.modal;
  if (!root) return;
  if (!m) { root.innerHTML = ""; return; }
  const title = m.kind === "waste" ? t("Log waste / shrinkage") : m.kind === "reject" ? t("Reject with Reason") : t("Flag purchase");
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-close"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head"><h2 id="modalTitle">${title}</h2>
        <button type="button" class="btn icon-btn ghost" data-action="modal-close" aria-label="${t("Close")}">${icon("x")}</button></div>
      ${m.kind === "waste" ? wasteForm() : reasonForm(m.kind, m.id)}
    </div>`;
  document.body.classList.add("modal-open");
  if (m.kind === "waste") {
    const input = $<HTMLInputElement>("#wItem");
    const list = $<HTMLUListElement>("#wItemList");
    if (input && list) attachCombobox(input, list, source, (o) => pickItem(o.value));
    $<HTMLElement>(w.itemId ? "#wQty" : "#wItem")?.focus();
  } else {
    $<HTMLElement>('[data-action="r-pick"]')?.focus();
  }
}

function pickItem(i: InventoryItem): void {
  w.itemId = i.id;
  w.query = "";
  clearErrors(["item"]);
  recalcValue();
  renderModal();
  $<HTMLElement>("#wQty")?.focus();
}

function recalcValue(): void {
  const it = w.itemId ? item(w.itemId) : undefined;
  if (!it || w.valueEdited) return;
  const q = parseAmount(w.qty);
  w.value = q > 0 ? plain(q * it.unitCost) : "";
  const el = $<HTMLInputElement>("#wValue");
  if (el) el.value = w.value;
  if (parseAmount(w.value) > 0) clearErrors(["value"]);
}

export function onModalInput(scope: string, key: string, value: string): void {
  if (scope === "waste") {
    if (key === "query") { w.query = value; if (w.itemId) { w.itemId = null; } }
    else if (key === "qty") { w.qty = value; clearErrors(["qty"]); recalcValue(); }
    else if (key === "value") { w.value = value; w.valueEdited = true; clearErrors(["value"]); }
    else if (key === "notes") { w.notes = value; clearErrors(["notes"]); }
    else if (key === "reporter") w.reporter = value;
  } else if (scope === "reason" && key === "text") {
    reasonText = value;
    if (value.trim()) { reason = ""; $$<HTMLElement>('[data-action="r-pick"]').forEach((b) => b.setAttribute("aria-pressed", "false")); }
    clearErrors(["reason"]);
  }
}

/* ---------- submit ---------- */

export function submitWaste(): void {
  const it = w.itemId ? item(w.itemId) : undefined;
  const q = parseAmount(w.qty);
  const v = parseAmount(w.value);
  const errors: FieldErrors = {};
  if (!it) errors.item = t("Choose the item from the list.");
  if (!(q > 0)) errors.qty = t("Enter a quantity above 0.");
  else if (it && q > it.currentQuantity) errors.qty = t("Only {q} in stock.", { q: qtyUnit(it.currentQuantity, it.unit) });
  if (!(v > 0)) errors.value = t("Enter the loss value.");
  if (!w.reason) errors.reason = t("Choose a reason.");
  else if (NOTE_REQUIRED.has(w.reason) && !w.notes.trim()) errors.notes = t("Add a note for this reason.");
  if (showErrors(errors, ["item", "qty", "value", "reason", "notes"]) || !it || !w.reason) {
    if (errors.reason && !errors.item && !errors.qty && !errors.value) $<HTMLElement>('[data-action="w-reason"]')?.focus();
    return;
  }
  const rec = logWaste({ itemId: it.id, itemName: it.nameKey, quantityLost: q, unit: it.unit, lossValue: round2(v), reason: w.reason, customNotes: w.notes.trim() || undefined, reportedBy: w.reporter });
  closeModal();
  rerender();
  toast(t("Logged {q} {item} · {x} · {r} · by {name}", { q: qtyUnit(q, it.unit), item: tk(it.nameKey), x: money(rec.lossValue, 0), r: tk(`waste.${rec.reason}`), name: user().name }),
    () => { removeWaste(rec.id); rerender(); });
}

export function submitReason(): void {
  const m = state.modal;
  if (!m || m.kind === "waste") return;
  const text = reasonText.trim() || (reason ? reason : "");
  if (!text) {
    showErrors({ reason: t("Pick a reason or write one.") }, ["reason"]);
    return;
  }
  const id = m.id;
  if (m.kind === "reject") {
    const d = db.dispatches.find((x) => x.id === id);
    if (!d || !rejectDispatch(id, text)) { closeModal(); return; }
    closeModal();
    rerender();
    toast(t("Rejected {item} → {dest} · by {name}", { item: tk(d.itemName), dest: tk(`dest.${d.destination}`), name: user().name }), () => { reopenDispatch(id); rerender(); });
  } else {
    const p = db.purchases.find((x) => x.id === id);
    const it = p ? item(p.itemId) : undefined;
    if (!p || !it || !flagPurchase(id, text)) { closeModal(); return; }
    closeModal();
    rerender();
    toast(t("Flagged {item} · by {name}", { item: tk(it.nameKey), name: user().name }), () => { reopenPurchase(id, false); rerender(); });
  }
}

export const modalActions: ActionMap = {
  "modal-close": () => closeModal(),
  "w-reason": (el) => {
    const v = el.dataset.value ?? "";
    if (!isWasteReason(v)) return;
    w.reason = v;
    clearErrors(["reason"]);
    renderModal();
    $<HTMLElement>(`[data-action="w-reason"][data-value="${v}"]`)?.focus();
  },
  "r-pick": (el) => {
    reason = el.dataset.value ?? "";
    reasonText = "";
    const ta = $<HTMLTextAreaElement>("#rText");
    if (ta) ta.value = "";
    $$<HTMLElement>('[data-action="r-pick"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
    clearErrors(["reason"]);
  },
};

/** Keep Tab inside the open dialog and close on Escape. */
export function modalKeydown(e: KeyboardEvent): void {
  if (!state.modal) return;
  if (e.key === "Escape") {
    if ((e.target as HTMLElement).getAttribute("aria-expanded") === "true") return; // let the combobox close first
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key !== "Tab") return;
  const box = $(".modal");
  if (!box) return;
  const items = $$<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', box).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
