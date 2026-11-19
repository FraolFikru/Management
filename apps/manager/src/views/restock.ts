/* Restock requests: the manager picks what to buy and sends it to the
   Purchases team. The low-stock items come pre-filled with a suggested
   amount; any other stock item can be added. The card on the Overview
   shows what happened to each request (waiting, ordered, bought, can't buy). */

import type { InventoryItem, RestockRequest } from "../types";
import { t, tk, tkAll } from "../i18n";
import { normalize, parseAmount, plain } from "../format";
import {
  RESTOCK_WAITING, cancelRestock, db, item, lowStock, openRestockFor, reopenRestock, sendRestock, state, suggestedOrder, user,
} from "../store";
import { $, esc, highlight, icon } from "../ui/dom";
import { attachCombobox, type ComboOption } from "../ui/combobox";
import { qtyUnit, stampOf, unitName } from "../ui/shared";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";

interface Line { itemId: string; checked: boolean; qty: string }
let lines: Line[] = [];
let note = "";
let error = "";
let sending = false;

/** Fill the dialog: every low item, ticked with a suggested amount (unless it was already asked for). */
export function freshRestock(): void {
  lines = lowStock().map((i) => {
    const open = openRestockFor(i.id);
    return { itemId: i.id, checked: !open, qty: plain(open ? open.quantity : suggestedOrder(i)) };
  });
  note = "";
  error = "";
  sending = false;
}

const picked = (): Line[] => lines.filter((l) => l.checked && parseAmount(l.qty) > 0 && item(l.itemId));

function lineRow(l: Line): string {
  const it = item(l.itemId);
  if (!it) return "";
  const open = openRestockFor(it.id);
  return `<li class="rs-row${l.checked ? " on" : ""}">
    <label class="rs-check">
      <input type="checkbox" data-rs="check" data-id="${esc(it.id)}" ${l.checked ? "checked" : ""}>
      <span class="rs-name"><strong>${esc(tk(it.nameKey))}</strong>
        <small>${t("{q} in stock", { q: qtyUnit(it.currentQuantity, it.unit) })} · ${t("reorder at {x}", { x: qtyUnit(it.reorderPoint, it.unit) })}</small>
        ${open ? `<small class="rs-already">${t("Already asked for {q} · {status}", { q: qtyUnit(open.quantity, open.unit), status: statusLabel(open) })}</small>` : ""}</span>
    </label>
    <div class="affix right rs-qty"><input class="input num-in" inputmode="decimal" autocomplete="off" aria-label="${t("Quantity to buy for {item}", { item: tk(it.nameKey) })}"
      data-rs="qty" data-id="${esc(it.id)}" value="${esc(l.qty)}"><span>${esc(unitName(it.unit))}</span></div>
  </li>`;
}

export function restockForm(): string {
  const n = picked().length;
  return `
    <form id="restockForm" class="form" novalidate>
      <p class="meta">${t("Tick what to buy and how much. The Purchases team sees it straight away, and it closes by itself when they log the purchase.")}</p>
      ${lines.length ? `<ul class="rs-list">${lines.map(lineRow).join("")}</ul>` : `<p class="meta">${t("Nothing is low right now. Add any item below.")}</p>`}
      <div class="field"><label for="rsAdd">${t("Add another item")}</label>
        <div class="combo">
          <input id="rsAdd" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rsAddList"
            autocomplete="off" placeholder="${t("Search stock, e.g. “tom” for Tomato")}">
          <ul id="rsAddList" class="combo-list" role="listbox" aria-label="${t("Suggestions")}" hidden></ul>
        </div></div>
      <div class="field"><label for="rsNote">${t("Note for Purchases")} <span class="opt-label">${t("(optional)")}</span></label>
        <textarea id="rsNote" class="input" rows="2" data-rs="note" placeholder="${t("e.g. needed before Friday, buy from the usual vendor")}">${esc(note)}</textarea></div>
      <p class="err" id="err-rs" role="alert">${esc(error)}</p>
      <div class="modal-foot">
        <small class="stamp">${icon("user")} ${t("Will be sent by {name} ({id})", { name: esc(user().name), id: esc(user().userId) })}</small>
        <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
          <button type="submit" class="btn primary" id="rsSend" ${sending ? "disabled" : ""}>${icon("truck")} ${n ? t("Send to Purchases ({n})", { n }) : t("Send to Purchases")}</button></div>
      </div>
    </form>`;
}

/* ---------- add-item search ---------- */

function source(query: string): { heading: string; options: ComboOption<InventoryItem>[] } {
  const q = normalize(query);
  if (!q) return { heading: "", options: [] };
  const have = new Set(lines.map((l) => l.itemId));
  const list = db.inventory
    .filter((i) => !have.has(i.id))
    .map((i) => {
      const texts = [...tkAll(i.nameKey), ...i.aliases].map(normalize);
      return { i, score: texts.some((x) => x.startsWith(q)) ? 2 : texts.some((x) => x.includes(q)) ? 1 : 0 };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.i);
  return {
    heading: list.length ? t("Stock items") : "",
    options: list.map((i) => {
      const name = tk(i.nameKey);
      const at = normalize(name).indexOf(q);
      return {
        value: i,
        html: `<span class="opt-main"><span class="opt-name">${at >= 0 ? highlight(name, at, query.trim().length) : esc(name)}</span>
          <span class="opt-crumb">${esc(tk(`cogs.${i.category}`))}</span></span>
          <span class="opt-side"><span class="mono">${t("{q} in stock", { q: qtyUnit(i.currentQuantity, i.unit) })}</span></span>`,
      };
    }),
  };
}

/** Called by renderModal after the form is on screen. */
export function mountRestock(redraw: () => void): void {
  const input = $<HTMLInputElement>("#rsAdd");
  const list = $<HTMLUListElement>("#rsAddList");
  if (input && list) attachCombobox(input, list, source, (o) => {
    const i = o.value;
    const open = openRestockFor(i.id);
    // a low item gets the suggested amount; anything else starts empty so the manager types it
    const low = i.currentQuantity <= i.reorderPoint;
    lines.push({ itemId: i.id, checked: true, qty: open ? plain(open.quantity) : low ? plain(suggestedOrder(i)) : "" });
    error = "";
    redraw();
    $<HTMLInputElement>(`[data-rs="qty"][data-id="${CSS.escape(i.id)}"]`)?.select();
  });
  const first = $<HTMLElement>('[data-rs="qty"]') ?? input;
  first?.focus();
}

function refreshSendLabel(): void {
  const b = $("#rsSend");
  const n = picked().length;
  if (b) b.innerHTML = `${icon("truck")} ${n ? t("Send to Purchases ({n})", { n }) : t("Send to Purchases")}`;
}

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  const kind = el.dataset?.rs;
  if (!kind || state.modal?.kind !== "restock") return;
  if (kind === "note") { note = el.value; return; }
  const l = lines.find((x) => x.itemId === el.dataset.id);
  if (!l) return;
  if (kind === "check") { l.checked = el.checked; el.closest(".rs-row")?.classList.toggle("on", l.checked); }
  else if (kind === "qty") {
    l.qty = el.value;
    if (parseAmount(el.value) > 0 && !l.checked) {
      l.checked = true;
      const box = el.closest(".rs-row")?.querySelector<HTMLInputElement>('[data-rs="check"]');
      if (box) box.checked = true;
      el.closest(".rs-row")?.classList.add("on");
    }
  }
  if (error) { error = ""; const err = $("#err-rs"); if (err) err.textContent = ""; }
  refreshSendLabel();
});

export function submitRestock(close: () => void): void {
  if (sending) return;
  const send = picked();
  const bad = lines.find((l) => l.checked && !(parseAmount(l.qty) > 0));
  if (bad) {
    error = t("Enter how much to buy for {item}.", { item: tk(item(bad.itemId)?.nameKey ?? bad.itemId) });
    const err = $("#err-rs"); if (err) err.textContent = error;
    $<HTMLInputElement>(`[data-rs="qty"][data-id="${CSS.escape(bad.itemId)}"]`)?.focus();
    return;
  }
  if (!send.length) {
    error = t("Tick at least one item.");
    const err = $("#err-rs"); if (err) err.textContent = error;
    return;
  }
  sending = true;
  const payload = send.map((l) => ({ itemId: l.itemId, quantity: parseAmount(l.qty) }));
  const n = payload.length;
  void sendRestock(payload, note.trim()).then((ok) => {
    sending = false;
    if (!ok) { rerender(); return; }
    rerender();
  });
  close();
  rerender();
  toast(n === 1 ? t("Restock request sent to Purchases") : t("{n} restock requests sent to Purchases", { n }));
}

/* ---------- status ---------- */

export function statusLabel(r: RestockRequest): string {
  if (r.status === "OPEN") return r.bought > 0 ? t("Part bought") : t("Waiting");
  if (r.status === "ORDERED") return r.bought > 0 ? t("Part bought") : t("Ordered");
  if (r.status === "DONE") return t("Bought");
  if (r.status === "DECLINED") return t("Can't buy");
  return t("Cancelled");
}

const PILL: Record<RestockRequest["status"], string> = { OPEN: "pending", ORDERED: "ordered", DONE: "approved", DECLINED: "rejected", CANCELLED: "cancelled" };

function requestRow(r: RestockRequest): string {
  const name = tk(r.nameKey) || r.name || r.itemId;
  const waiting = RESTOCK_WAITING.includes(r.status);
  const detail: string[] = [];
  if (r.bought > 0 && r.status !== "DONE") detail.push(t("Bought {b} of {q}", { b: qtyUnit(r.bought, r.unit), q: qtyUnit(r.quantity, r.unit) }));
  if (r.status === "ORDERED" && r.handledByName) detail.push(t("Ordered by {name}", { name: esc(r.handledByName) }));
  if (r.status === "DECLINED") detail.push(`<span class="bad-text">${esc(r.reason)}</span>${r.handledByName ? ` · ${esc(r.handledByName)}` : ""}`);
  if (r.note) detail.push(`“${esc(r.note)}”`);
  return `<li class="rs-req">
    <div class="rs-req-main">
      <div class="rs-req-top"><strong>${esc(name)}</strong> <span class="num">${qtyUnit(r.quantity, r.unit)}</span>
        <span class="pill ${PILL[r.status]}">${statusLabel(r)}</span></div>
      ${detail.length ? `<small class="rs-req-detail">${detail.join(" · ")}</small>` : ""}
      <small>${stampOf(r.requestedBy, r.requestedAt, t("Asked by"))}</small>
    </div>
    <div class="rs-req-act">
      ${waiting ? `<button type="button" class="btn small ghost" data-action="restock-cancel" data-id="${esc(r.id)}">${t("Cancel")}</button>` : ""}
      ${r.status === "DECLINED" || r.status === "CANCELLED" ? `<button type="button" class="btn small" data-action="restock-reopen" data-id="${esc(r.id)}">${t("Ask again")}</button>` : ""}
    </div>
  </li>`;
}

/** Overview card: what was asked for and where it stands. Hidden when nothing was asked in the last two weeks. */
export function restockCard(limit = 8): string {
  if (!db.restock.length) return "";
  const order = (r: RestockRequest): number => (r.status === "DECLINED" ? 0 : RESTOCK_WAITING.includes(r.status) ? 1 : 2);
  const list = [...db.restock].sort((a, b) => order(a) - order(b) || (a.requestedAt < b.requestedAt ? 1 : -1));
  const waiting = db.restock.filter((r) => RESTOCK_WAITING.includes(r.status)).length;
  const declined = db.restock.filter((r) => r.status === "DECLINED").length;
  return `<section class="card" id="restockCard" aria-labelledby="rsTitle">
    <div class="card-head"><div><h2 id="rsTitle">${icon("truck")} ${t("Restock requests")}</h2>
      <p>${t("{n} waiting for Purchases", { n: waiting })}${declined ? ` · <strong class="bad-text">${t("{n} can't be bought", { n: declined })}</strong>` : ""}</p></div>
      <button type="button" class="btn small" data-action="restock-open">${icon("plus")} ${t("New request")}</button></div>
    <ul class="rs-reqs">${list.slice(0, limit).map(requestRow).join("")}</ul>
    ${list.length > limit ? `<p class="meta more-low">${t("+{n} older requests", { n: list.length - limit })}</p>` : ""}
  </section>`;
}

export const restockActions: ActionMap = {
  "restock-cancel": (el) => {
    const id = el.dataset.id ?? "";
    const r = db.restock.find((x) => x.id === id);
    if (!r) return;
    cancelRestock(id);
    rerender();
    toast(t("Cancelled the request for {item}", { item: tk(r.nameKey) }), () => { reopenRestock(id); rerender(); });
  },
  "restock-reopen": (el) => {
    const id = el.dataset.id ?? "";
    const r = db.restock.find((x) => x.id === id);
    if (!r) return;
    reopenRestock(id);
    rerender();
    toast(t("Sent {item} to Purchases again", { item: tk(r.nameKey) }));
  },
};
