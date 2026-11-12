/* Header (filters, stats, controls) and the three status columns. */

import type { ConnectionState, KDSOrderStatus, OrderTypeFilter, StationFilter } from "../types";
import { STATIONS } from "../catalog";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { clock, duration } from "../format";
import { audioReady } from "../sound";
import { avgPrepMs, column, feedKind, lateCount, openCount, state } from "../store";
import { esc, icon } from "./dom";
import { helpButton } from "../support";
import { ticketCard } from "./ticket";

const CONN: Record<ConnectionState, string> = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", offline: "Offline" };

const COLUMNS: readonly { status: KDSOrderStatus; title: string; hint: string; empty: string }[] = [
  { status: "PENDING", title: "Pending", hint: "New orders from the sales counter", empty: "No new orders" },
  { status: "PREPARING", title: "Preparing", hint: "Being cooked now", empty: "Nothing cooking" },
  { status: "READY", title: "Ready", hint: "Waiting for pickup", empty: "Nothing waiting" },
];

function stationChips(): string {
  const opts: StationFilter[] = ["ALL", ...STATIONS];
  return `<div class="chips" role="group" aria-label="${esc(t("Stations"))}">${opts.map((s) => {
    const n = openCount(s);
    return `<button type="button" class="chip" data-action="station" data-value="${s}" aria-pressed="${state.station === s}">
      <span>${esc(s === "ALL" ? t("All stations") : tk(`station.${s}`))}</span>${n ? `<b class="count">${n}</b>` : ""}</button>`;
  }).join("")}</div>`;
}

function typeSeg(): string {
  const opts: [OrderTypeFilter, string][] = [["ALL", t("All")], ["DINE_IN", t("Dine-in")], ["TAKEOUT", t("Takeout")]];
  return `<div class="seg" role="group" aria-label="${esc(t("Order type"))}">${opts.map(([v, l]) =>
    `<button type="button" data-action="type" data-value="${v}" aria-pressed="${state.type === v}">${esc(l)}</button>`).join("")}</div>`;
}

function langSeg(): string {
  return `<div class="seg lang" role="group" aria-label="${esc(t("Language"))}">${LANGUAGES.map((l) =>
    `<button type="button" data-action="lang" data-value="${l.code}" aria-pressed="${getLanguage() === l.code}" lang="${l.code}" title="${esc(l.name)}">${esc(l.short)}</button>`).join("")}</div>`;
}

export function header(): string {
  const late = lateCount();
  const avg = avgPrepMs();
  const last = state.recall[state.recall.length - 1];
  return `<header class="topbar">
    <div class="brand">
      <span class="logo" aria-hidden="true"><img class="brand-logo" src="/logo-light.png" alt=""><img class="brand-logo dark-only" src="/logo-dark.png" alt=""></span>
      <div><strong>${esc(t("Kitchen Display"))}</strong><small>${esc(t("Bole Branch"))}${feedKind() === "demo" ? ` · ${esc(t("Demo feed"))}` : ""}</small></div>
    </div>
    ${stationChips()}
    ${typeSeg()}
    <div class="stats">
      <span class="stat ${late ? "bad" : ""}"><b>${late}</b>${esc(t("Late"))}</span>
      <span class="stat"><b>${avg === null ? "—" : esc(duration(avg))}</b>${esc(t("Avg prep"))}</span>
    </div>
    <div class="controls">
      <button type="button" class="icon-btn" data-action="recall" ${last ? "" : "disabled"} title="${esc(t("Recall last picked-up order"))}" aria-label="${esc(t("Recall last picked-up order"))}">
        ${icon("recall")}<span class="lbl">${esc(t("Recall"))}${last ? ` <small>#${esc(last.orderNumber)}</small>` : ""}</span></button>
      <span class="conn c-${state.connection}" role="status"><i aria-hidden="true"></i>${esc(t(CONN[state.connection]))}</span>
      <button type="button" class="icon-btn" data-action="sound" aria-pressed="${state.sound}" aria-label="${esc(t(state.sound ? "Sound on" : "Sound off"))}" title="${esc(t(state.sound ? "Sound on" : "Sound off"))}">${icon(state.sound ? "bell" : "bellOff")}</button>
      <button type="button" class="icon-btn" data-action="theme" aria-label="${esc(t(state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"))}" title="${esc(t(state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"))}">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
      ${helpButton(t, "icon-btn")}
      <button type="button" class="icon-btn" data-action="fullscreen" aria-label="${esc(t("Full screen"))}" title="${esc(t("Full screen"))}">${icon("expand")}</button>
      ${langSeg()}
      <time class="clock" data-clock>${esc(clock(state.now))}</time>
    </div>
  </header>`;
}

function banners(): string {
  const out: string[] = [];
  if (state.connection === "offline" || state.connection === "reconnecting")
    out.push(`<div class="banner warn" role="alert">${icon("alert")}${esc(t("Connection lost. Showing the last known orders; changes will be retried."))}</div>`);
  if (state.sound && !audioReady())
    out.push(`<button type="button" class="banner info" data-action="unlock">${icon("bell")}${esc(t("Tap anywhere to turn on order sounds"))}</button>`);
  return out.join("");
}

export function board(): string {
  return `${header()}${banners()}
  <main class="board">${COLUMNS.map((c) => {
    const list = column(c.status);
    return `<section class="col col-${c.status.toLowerCase()}" aria-labelledby="h-${c.status}">
      <header class="col-head">
        <h2 id="h-${c.status}">${esc(t(c.title))} <span class="col-count">${list.length}</span></h2>
        <small>${esc(t(c.hint))}</small>
      </header>
      <div class="col-body">${list.length ? list.map(ticketCard).join("") : `<p class="empty">${esc(t(c.empty))}</p>`}</div>
    </section>`;
  }).join("")}</main>`;
}
