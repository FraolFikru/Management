/* One order ticket card. All ticket text is escaped; dish, modifier and
   station names are translated when known, otherwise shown as sent. */

import type { KitchenItem, KitchenTicket, OrderItemModifier, Urgency } from "../types";
import { STAFF } from "../catalog";
import { t, tk, tkMaybe } from "../i18n";
import { clock, duration } from "../format";
import { elapsedMs, isFresh, itemsFor, state, urgencyOf } from "../store";
import { esc, icon } from "./dom";

const URGENCY_LABEL: Record<Urgency, string> = { ok: "on time", warn: "getting late", late: "late, urgent" };

const dishName = (it: KitchenItem): string => tkMaybe(`menu.${it.menuItemId}`) ?? it.itemName;

function modifierChip(m: OrderItemModifier): string {
  const label = tkMaybe(`mod.${m.id}`) ?? m.name;
  const alert = m.id === "allergy";
  return `<span class="mod ${alert ? "alert" : ""}">${alert ? icon("alert") : ""}${esc(label)}${m.note ? `<em>${esc(m.note)}</em>` : ""}</span>`;
}

function itemRow(tkt: KitchenTicket, it: KitchenItem): string {
  const locked = tkt.status === "READY" || state.busy.has(tkt.id);
  return `<li>
    <button type="button" class="item ${it.isCompleted ? "done" : ""}" data-action="item" data-ticket="${esc(tkt.id)}" data-item="${esc(it.id)}"
      aria-pressed="${it.isCompleted}" ${locked ? "disabled" : ""}>
      <span class="check" aria-hidden="true">${it.isCompleted ? icon("check") : ""}</span>
      <span class="qty">${esc(it.quantity)}×</span>
      <span class="dish">
        <span class="dish-name">${esc(dishName(it))}</span>
        ${state.station === "ALL" ? `<span class="station-tag">${esc(tk(`station.${it.station}`))}</span>` : ""}
        ${it.modifiers?.length ? `<span class="mods">${it.modifiers.map(modifierChip).join("")}</span>` : ""}
      </span>
    </button>
  </li>`;
}

/** Timer text + accessible label; also used by the once-a-second updater. */
export function timerView(tkt: KitchenTicket): { text: string; urgency: Urgency; label: string } {
  const ms = elapsedMs(tkt);
  const urgency = urgencyOf(ms);
  const text = duration(ms);
  return { text, urgency, label: t("Elapsed time {time}, {level}", { time: text, level: t(URGENCY_LABEL[urgency]) }) };
}

export function waitingText(tkt: KitchenTicket): string {
  return tkt.readyAt ? t("Waiting {time}", { time: duration(state.now - Date.parse(tkt.readyAt)) }) : "";
}

function actions(tkt: KitchenTicket, allDone: boolean, waitingOn: string[]): string {
  const busy = state.busy.has(tkt.id) ? "disabled" : "";
  const back = (to: "PENDING" | "PREPARING"): string =>
    `<button type="button" class="btn ghost" data-action="status" data-id="${esc(tkt.id)}" data-status="${to}" ${busy}
      aria-label="${esc(t("Move back to {status}", { status: t(to === "PENDING" ? "Pending" : "Preparing") }))}">${icon("back")}<span>${esc(t("Back"))}</span></button>`;
  if (tkt.status === "PENDING")
    return `<button type="button" class="btn primary start" data-action="status" data-id="${esc(tkt.id)}" data-status="PREPARING" ${busy}>${icon("play")}<span>${esc(t("Start"))}</span></button>`;
  if (tkt.status === "PREPARING" && waitingOn.length)
    // a station view can't send the whole order out while other stations are still cooking
    return `${back("PENDING")}<span class="btn waiting" role="status">${icon("clock")}<span>${esc(t("Waiting for {stations}", { stations: waitingOn.join(", ") }))}</span></span>`;
  if (tkt.status === "PREPARING")
    return `${back("PENDING")}<button type="button" class="btn primary ready ${allDone ? "nudge" : ""}" data-action="status" data-id="${esc(tkt.id)}" data-status="READY" ${busy}>${icon("check")}<span>${esc(t("Mark ready"))}</span></button>`;
  return `${back("PREPARING")}<button type="button" class="btn primary pickup" data-action="bump" data-id="${esc(tkt.id)}" ${busy}>${icon("hand")}<span>${esc(t("Picked up"))}</span></button>`;
}

export function ticketCard(tkt: KitchenTicket): string {
  const shown = itemsFor(tkt);
  const hidden = tkt.items.length - shown.length;
  const done = shown.filter((i) => i.isCompleted).length;
  const allDone = done === shown.length;
  const othersOpen = tkt.items.filter((i) => !shown.includes(i) && !i.isCompleted);
  const waitingOn = allDone ? [...new Set(othersOpen.map((i) => tk(`station.${i.station}`)))] : [];
  const tm = timerView(tkt);
  const staff = STAFF[tkt.submittedBy];
  const who = staff ? staff.name : tkt.submittedBy;
  const fresh = isFresh(tkt.id);
  const late = tm.urgency === "late" && tkt.status !== "READY";

  const type = tkt.orderType === "DINE_IN"
    ? `<span class="type dine">${icon("table")}${esc(t("Table {n}", { n: tkt.tableNumber ?? "?" }))}</span>`
    : `<span class="type take">${icon("bag")}${esc(t("Takeout"))}${tkt.customerName ? ` · ${esc(tkt.customerName)}` : ""}</span>`;

  return `<article class="ticket u-${tm.urgency} s-${tkt.status.toLowerCase()} ${fresh ? "fresh" : ""} ${late ? "flash" : ""} ${state.busy.has(tkt.id) ? "busy" : ""}"
      data-ticket-id="${esc(tkt.id)}" aria-label="${esc(`${tkt.orderNumber}, ${tkt.orderType === "DINE_IN" ? t("Table {n}", { n: tkt.tableNumber ?? "?" }) : t("Takeout")}`)}">
    <header class="tk-head">
      <div class="tk-title">
        <span class="tk-no">#${esc(tkt.orderNumber)}</span>
        ${fresh ? `<span class="badge-new">${esc(t("NEW"))}</span>` : ""}
      </div>
      <div class="timer t-${tm.urgency}" role="timer" data-timer="${esc(tkt.id)}" aria-label="${esc(tm.label)}">
        ${late ? icon("flame") : icon("clock")}<span class="tval">${esc(tm.text)}</span>
      </div>
    </header>
    <div class="tk-meta">
      ${type}
      <span class="meta-line">${esc(t("Placed {time}", { time: clock(tkt.createdAt) }))} · ${esc(t("Waiter {name}", { name: who }))}${staff ? ` <span class="staff-id">${esc(tkt.submittedBy)}</span>` : ""}</span>
      ${tkt.status === "READY" ? `<span class="meta-line ready-line"><span>${esc(t("Prep time {time}", { time: tm.text }))}</span> · <span data-waiting="${esc(tkt.id)}">${esc(waitingText(tkt))}</span></span>` : ""}
    </div>
    <ul class="tk-items">${shown.map((it) => itemRow(tkt, it)).join("")}</ul>
    ${hidden > 0 ? `<p class="tk-more">${esc(t("+{n} more at other stations", { n: hidden }))}</p>` : ""}
    ${tkt.status !== "READY" ? `<div class="progress ${allDone ? "complete" : ""}" aria-hidden="${done === 0}">
      <div class="bar"><i style="width:${Math.round((done / shown.length) * 100)}%"></i></div>
      <span>${esc(allDone ? t("All items done") : done ? t("{done} of {total} done", { done, total: shown.length }) : t("Tap a dish to mark it done"))}</span>
    </div>` : ""}
    <footer class="tk-actions">${actions(tkt, allDone && !othersOpen.length, waitingOn)}</footer>
  </article>`;
}
