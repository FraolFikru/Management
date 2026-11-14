/* What each screen looks like. Pure functions of the store: state in, HTML out.
   Layout follows the waiter design: a floor plan of tables, a waiting list,
   a dish grid with add counters, and an order review with steppers. */

import { helpButton } from "./support";
import { isConfigured, sessionUser } from "./api";
import { LANGS, money, nm, since, t } from "./i18n";
import { areas, canEdit, draftTotal, draftsOf, isOpen, item, me, order, orders, sending, state, tableOf, visibleTables, waitingTables } from "./store";
import type { Draft, FloorTable, LineState, MenuItem, Order, OrderLine, PayMethod, TableStatus } from "./types";

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const P = {
  back: "M15 5l-7 7 7 7", more: "M5 12h.01M12 12h.01M19 12h.01", people: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6",
  person: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", search: "M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14", close: "M6 6l12 12M18 6L6 18",
  send: "M4 12l16-8-6 16-3-7-7-1z", pause: "M9 5v14M15 5v14", bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 21h4", check: "M5 12.5l4.5 4.5L19 7.5",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6", swap: "M7 7h13l-3-3M17 17H4l3 3", flame: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14", note: "M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4", wifi: "M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M12 19.5h.01",
  table: "M3 8h18M5 8v11M19 8v11M3 8l2-3h14l2 3", out: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  chev: "M9 6l6 6-6 6", tiles: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z", leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
};
export const icon = (n: keyof typeof P, cls = ""): string =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

const STATUS: Record<TableStatus | "PAID" | "VOIDED", { label: string; cls: string }> = {
  FREE: { label: "Free", cls: "free" }, SEATED: { label: "Seated", cls: "seated" }, IN_KITCHEN: { label: "In kitchen", cls: "kitchen" },
  READY: { label: "Food ready", cls: "ready" }, SERVED: { label: "Served", cls: "served" }, BILL: { label: "Ready for bill", cls: "bill" },
  PAID: { label: "Paid", cls: "free" }, VOIDED: { label: "Closed", cls: "free" },
};
const pill = (s: keyof typeof STATUS): string => `<span class="pill st-${STATUS[s].cls}">${esc(t(STATUS[s].label))}</span>`;
const clock = (): string => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

/** "Table 3" for a table called 3; names like "T3" or "Window" stay as they are. */
export const tableLabel = (name: string): string => (/^\d+$/.test(name.trim()) ? t("Table {n}", { n: name.trim() }) : name);

/* ---------- illustrations ---------- */

/** Category glyphs for the round category buttons (stroke icons, 24×24). */
const CAT_ICON: Record<string, string> = {
  ALL: `<path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"/>`,
  MAINS: `<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7.5c0-1.6 1-2 1-3.5M12 7.5c0-1.6 1-2 1-3.5M16 7.5c0-1.6 1-2 1-3.5"/>`,
  FASTING: `<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19l7-7"/>`,
  BREAKFAST: `<path d="M3 18h18"/><path d="M4.5 18a7.5 7.5 0 0 1 15 0"/><path d="M9 6.5c0-1.2 1-1.5 1-2.5M14 6.5c0-1.2 1-1.5 1-2.5"/>`,
  HOT_DRINKS: `<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1-1 1.3-1 2.5M12 3.5c0 1-1 1.3-1 2.5"/>`,
  COLD_DRINKS: `<path d="M6 3h12l-1.5 8a4.5 4.5 0 0 1-9 0z"/><path d="M12 11v9M8 21h8"/>`,
  BAR: `<path d="M10 2h4v4l2 3v12H8V9l2-3z"/><path d="M8 13h8"/>`,
  SIDES: `<path d="M3 13a9 9 0 0 0 18 0z"/><path d="M2 13h20"/>`,
  OTHER: `<path d="M5 20h14l-1-9a6 6 0 0 0-12 0z"/><path d="M12 2v3"/>`,
};
const catIcon = (code: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAT_ICON[code] ?? CAT_ICON.OTHER}</svg>`;

/** A small deterministic number from a string, so a dish always gets the same garnish. */
const hash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Plate drawings in the design's style: a dish seen from above, coloured by what kind of food it is. */
function plate(it: MenuItem | undefined): string {
  const code = it?.category ?? "OTHER", h = hash(it?.id ?? "x");
  const stews = ["#a4432b", "#c0612f", "#8a3a22", "#d0893c", "#b5532c"];
  const greens = ["#4e7c33", "#5d8c3f", "#6f9b4b", "#7aa64f"];
  const s1 = stews[h % stews.length], s2 = stews[(h >>> 3) % stews.length], g = greens[(h >>> 5) % greens.length];
  const svg = (inner: string): string => `<svg class="plate" viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
  switch (code) {
    case "HOT_DRINKS": return svg(`<circle cx="50" cy="50" r="42" fill="#efece4"/><circle cx="50" cy="50" r="26" fill="#f8f6f1" stroke="#e2ddd2" stroke-width="2"/><circle cx="50" cy="50" r="19" fill="${h % 2 ? "#6b3e1f" : "#b0622b"}"/><path d="M42 46c4-3 12-3 16 0" stroke="#e8c79a" stroke-width="2.4" fill="none" stroke-linecap="round"/><rect x="74" y="44" width="14" height="10" rx="5" fill="#f8f6f1" stroke="#e2ddd2" stroke-width="2"/>`);
    case "COLD_DRINKS": return svg(`<circle cx="50" cy="50" r="42" fill="#e9efe4"/><circle cx="50" cy="50" r="24" fill="${["#f2b134", "#e8743b", "#7fbf4d", "#d94f5c"][h % 4]}"/><circle cx="50" cy="50" r="24" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/><rect x="47" y="14" width="5" height="34" rx="2.5" fill="#fff" transform="rotate(18 50 30)"/><circle cx="42" cy="44" r="4" fill="#fff" opacity=".6"/>`);
    case "BAR": return svg(`<circle cx="50" cy="50" r="42" fill="#ece8df"/><rect x="40" y="18" width="20" height="62" rx="8" fill="${["#3e6b2e", "#7a4a1d", "#2f4f6e"][h % 3]}"/><rect x="45" y="10" width="10" height="14" rx="3" fill="#c9a24a"/><rect x="40" y="44" width="20" height="16" fill="#f3e3b5"/>`);
    case "BREAKFAST": return svg(`<circle cx="50" cy="50" r="42" fill="#3b3f3a"/><circle cx="50" cy="50" r="34" fill="#2f332e"/><circle cx="50" cy="52" r="24" fill="${["#c98f4e", "#d9a257", "#b9773d"][h % 3]}"/><path d="M32 52c6-6 12 4 18 0s12-6 18 0" stroke="#f3dda9" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="40" cy="42" r="4.5" fill="${s1}"/><circle cx="62" cy="58" r="3.5" fill="${g}"/>`);
    case "SIDES": return svg(`<circle cx="50" cy="50" r="42" fill="#efece4"/><circle cx="50" cy="50" r="30" fill="#f6f4ee"/><circle cx="50" cy="50" r="20" fill="${["#f4efe2", "#d9c9a4", "#e9ddc3"][h % 3]}"/><circle cx="44" cy="46" r="3" fill="#cfc2a6"/><circle cx="56" cy="54" r="3" fill="#cfc2a6"/><circle cx="54" cy="42" r="2.5" fill="${g}"/>`);
    case "FASTING": return svg(`<circle cx="50" cy="50" r="42" fill="#d9c9a4"/><circle cx="50" cy="50" r="36" fill="#e6d8b8"/><circle cx="36" cy="40" r="10" fill="#e0b83a"/><circle cx="62" cy="38" r="9" fill="${g}"/><circle cx="58" cy="62" r="10" fill="#c0612f"/><circle cx="36" cy="62" r="8" fill="#8a5a2b"/><circle cx="50" cy="50" r="6" fill="#d94f3c"/>`);
    default: {
      // injera with stews: the main stew moves around the plate, smaller portions beside it
      const a = (h % 360) * Math.PI / 180, cx = 50 + Math.cos(a) * 6, cy = 50 + Math.sin(a) * 6;
      const sides = [0, 1, 2].slice(0, 1 + (h % 3)).map((k) => {
        const b = a + 2.1 + k * 1.3;
        return `<circle cx="${(50 + Math.cos(b) * 22).toFixed(1)}" cy="${(50 + Math.sin(b) * 22).toFixed(1)}" r="${7 - k}" fill="${[s2, g, "#e0b83a"][k]}"/>`;
      }).join("");
      return svg(`<circle cx="50" cy="50" r="42" fill="#d9c9a4"/><circle cx="50" cy="50" r="36" fill="#e6d8b8"/><circle cx="50" cy="50" r="36" fill="none" stroke="#cdbb93" stroke-width="1.5" stroke-dasharray="1 4"/><ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="16" ry="12" transform="rotate(${h % 90} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="${s1}"/>${sides}<circle cx="${(cx - 4).toFixed(1)}" cy="${(cy - 4).toFixed(1)}" r="3" fill="#f3dda9" opacity=".8"/>`);
    }
  }
}

/* ---------- sign-in ---------- */

export const signInUi = { mode: "pin" as "pin" | "password", message: "", busy: false, first: "", };

export function renderSignIn(): string {
  const pin = signInUi.mode === "pin";
  return `
  <main class="signin">
    <form class="signin-card" id="signIn" novalidate>
      <div class="brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"><span><strong>SEER</strong><small>${t("Waiter")}</small></span></div>
      <h1>${t("Sign in")}</h1>
      <label class="field"><span>${t(pin ? "Staff code" : "Username")}</span>
        <input id="siFirst" value="${esc(signInUi.first)}" autocomplete="username" autocapitalize="${pin ? "characters" : "none"}" spellcheck="false" ${pin ? 'placeholder="W-101"' : ""}></label>
      <label class="field"><span>${t(pin ? "PIN" : "Password")}</span>
        <input id="siSecret" type="password" ${pin ? 'inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"' : 'autocomplete="current-password"'}></label>
      <p class="err" role="alert">${esc(signInUi.message)}</p>
      <button class="cta" type="submit" ${signInUi.busy ? "disabled" : ""}><span>${signInUi.busy ? t("Signing in…") : t("Sign in")}</span></button>
      <button class="link" type="button" data-act="signin-mode">${t(pin ? "Use username and password" : "Use staff code and PIN")}</button>
      ${pin ? `<p class="hint">${t("Your staff code is on your badge. Ask your manager for a PIN.")}</p>` : ""}
      ${langSeg()}
    </form>
  </main>`;
}

/** The sliding segmented control from the design. Thumb position comes from the number of options. */
function slide(opts: { act: string; id: string; label: string; on: boolean; aria?: string }[], label: string, cls = ""): string {
  const i = Math.max(0, opts.findIndex((o) => o.on));
  return `<div class="slide ${cls}" role="group" aria-label="${esc(label)}" style="--n:${opts.length};--i:${i}"><i class="thumb"></i>${opts.map((o) =>
    `<button type="button" data-act="${o.act}" data-id="${esc(o.id)}" aria-pressed="${o.on}" ${o.aria ? `aria-label="${esc(o.aria)}"` : ""}>${o.label}</button>`).join("")}</div>`;
}
const langSeg = (): string => slide(LANGS.map((l) => ({ act: "lang", id: l.code, label: l.label, on: state.lang === l.code })), t("Language"), "small");

/* ---------- top bar + tab bar ---------- */

function conn(): string {
  if (state.pending) return `<span class="conn wait">${icon("wifi")} ${t("{n} waiting to send", { n: state.pending })}</span>`;
  if (state.offline) return `<span class="conn off">${icon("wifi")} ${t("Offline")}</span>`;
  return `<span class="conn ${state.live ? "live" : ""}" title="${state.live ? "live" : "polling"}"><i></i></span>`;
}

function topBar(title: string): string {
  const u = sessionUser(), f = state.floor;
  return `
    <header class="top">
      <button class="who" data-act="profile" aria-label="${esc(u?.name ?? "")}">
        <span class="avatar">${esc(u?.initials || initials(u?.name ?? "?"))}</span>
        <span class="who-text"><strong>${esc(title)}</strong><small>${esc(f?.branch.name ?? "")} · ${clock()}</small></span>
      </button>
      ${conn()}
      ${helpButton(t, "icon-btn")}
    </header>`;
}

function tabBar(): string {
  const w = waitingTables().filter((x) => x.status === "READY" || x.status === "BILL").length;
  const tab = (id: string, label: string, glyph: string, on: boolean, badge = 0): string =>
    `<button class="tab ${on ? "on" : ""}" data-act="${id === "new" ? "new-order" : "view"}" data-id="${id}" aria-pressed="${on}">
      <span class="glyph">${glyph}${badge ? `<b class="tbadge">${badge}</b>` : ""}</span>${t(label)}</button>`;
  return `<nav class="tabbar" aria-label="${t("Screens")}">
    ${tab("new", "New order", icon("plus"), state.view === "tables" && state.picking)}
    ${tab("tables", "Tables", icon("tiles"), state.view === "tables" && !state.picking)}
    ${tab("waiting", "Waiting list", icon("clock"), state.view === "waiting", w)}
  </nav>`;
}

/* ---------- floor: tables ---------- */

/** Seats around a table, laid out from its seat count like the design's floor plan. */
function seatsOf(n: number): { t: number; b: number; l: number; r: number; w: number } {
  if (n <= 2) return { t: 0, b: 0, l: 1, r: 1, w: 46 };
  if (n <= 4) return { t: 2, b: 2, l: 0, r: 0, w: 62 };
  if (n <= 6) return { t: 3, b: 3, l: 0, r: 0, w: 92 };
  const side = Math.ceil(n / 2);
  return { t: side, b: n - side, l: 0, r: 0, w: Math.min(150, 26 * side + 10) };
}
const seatRow = (n: number, cls: string): string => (n ? `<span class="${cls}">${"<i></i>".repeat(n)}</span>` : "");

function tableTile(tb: FloorTable): string {
  const o = tb.order, m = me(), mine = !!o && o.waiterId === m?.id;
  const s = seatsOf(tb.seats), picked = state.picked === tb.id;
  const sub = !o ? t("{n} seats", { n: tb.seats }) : mine ? t("Me") : esc(o.waiterName ?? "—");
  const flag = tb.status === "READY" && o?.ready ? `<b class="tflag">${icon("bell")}${o.ready}</b>` : "";
  return `<button class="tbl st-${STATUS[tb.status].cls} ${mine ? "mine" : ""} ${picked ? "sel" : ""}" data-act="table" data-id="${tb.id}"
      aria-label="${esc(tb.name)}, ${esc(t(STATUS[tb.status].label))}${o ? `, ${o.guests} ${esc(t("Guests").toLowerCase())}` : ""}" aria-pressed="${picked}">
    ${seatRow(s.t, "s-top")}
    <span class="mid">${seatRow(s.l, "s-side")}<span class="slab" style="width:${s.w}px">${esc(tb.name)}${flag}</span>${seatRow(s.r, "s-side")}</span>
    ${seatRow(s.b, "s-bot")}
    <span class="tcap"><span class="pill st-${STATUS[tb.status].cls}">${esc(t(STATUS[tb.status].label))}</span><small>${sub}</small></span>
  </button>`;
}

function scopeSeg(): string {
  const m = me(), all = state.floor?.tables ?? [];
  const mine = all.filter((x) => x.order?.waiterId === m?.id).length;
  return slide([
    { act: "filter", id: "all", label: t("All tables"), on: state.filter === "all" },
    { act: "filter", id: "mine", label: `${t("My tables")} <b>${mine}</b>`, on: state.filter === "mine" },
  ], t("Which tables"));
}

function areaChips(): string {
  const list = areas();
  if (list.length < 2) return "";
  return `<div class="chips scroll" data-scroll="areas">${["", ...list].map((a) =>
    `<button class="chip" data-act="area" data-id="${esc(a)}" aria-pressed="${state.area === a}">${esc(a || t("All"))}</button>`).join("")}</div>`;
}

function emptyFloor(): string | null {
  const f = state.floor, m = me();
  if (state.floorError === "no-access") return `<main class="empty"><h2>${t("This account can't take tables.")}</h2><button class="btn" data-act="sign-out">${t("Sign out")}</button></main>`;
  if (!f) return `<main class="empty">${state.offline || state.floorError
    ? `<h2>${t("Cannot reach the server. It may be waking up — try again in a minute.")}</h2><button class="cta" data-act="reload"><span>${t("Try again")}</span></button>`
    : `<div class="spinner"></div><p>${t("Loading the floor…")}</p>`}</main>`;
  if (!f.tables.length) return `<main class="empty"><span class="big-ic">${icon("table")}</span><h2>${t("No tables here yet")}</h2>
      ${m?.canSetup ? `<button class="cta" data-act="setup"><span>${t("Set up tables")}</span></button>` : `<p>${t("Ask your manager to set up the tables for this branch.")}</p>`}</main>`;
  return null;
}

function renderTables(): string {
  const empty = emptyFloor();
  if (empty) return `${topBar(t("Tables"))}${empty}${tabBar()}`;
  const shown = visibleTables();
  const pickedTb = state.picked ? tableOf(state.picked) : undefined;
  const lead = state.picking ? t("Tap a free table to start a new order.") : state.filter === "mine" && !shown.length ? t("You have no tables yet. Tap a free one to open it.") : "";
  const body = shown.length ? `<div class="plan">${shown.map(tableTile).join("")}</div>`
    : `<div class="empty"><h2>${t("No tables in this view.")}</h2><button class="btn" data-act="filter" data-id="all">${t("All tables")}</button></div>`;
  return `${topBar(t("Tables"))}
    ${state.offline ? `<p class="banner">${t("Offline — showing the last known floor")}</p>` : ""}
    <div class="tools">${scopeSeg()}${areaChips()}</div>
    <main class="floor" data-scroll="floor">${lead ? `<p class="lead">${lead}</p>` : ""}${body}</main>
    <footer class="dock">
      <button class="ghost ${pickedTb ? "ready" : ""}" data-act="open-picked" ${pickedTb ? "" : "disabled"}>${pickedTb ? t("Open {table}", { table: tableLabel(pickedTb.name) }) : t("Select a free table")}</button>
      ${tabBar()}
    </footer>`;
}

/* ---------- floor: waiting list ---------- */

const WAIT_GROUPS: { status: TableStatus; title: string }[] = [
  { status: "READY", title: "Food ready" }, { status: "BILL", title: "Asked for the bill" }, { status: "IN_KITCHEN", title: "In kitchen" },
  { status: "SEATED", title: "Seated" }, { status: "SERVED", title: "Served" },
];

function waitCard(tb: FloorTable, now: number): string {
  const o = tb.order!, m = me(), mine = o.waiterId === m?.id;
  const extra = tb.status === "READY" && o.ready ? `<span class="tflag-line">${icon("bell")} ${t("{n} ready", { n: o.ready })}</span>`
    : o.held ? `<span class="tflag-line quiet">${icon("pause")} ${t("{n} held", { n: o.held })}</span>` : "";
  return `
    <article class="wcard st-${STATUS[tb.status].cls} ${mine ? "mine" : ""}">
      <button class="wmain" data-act="table" data-id="${tb.id}">
        <span class="wname">${esc(tableLabel(tb.name))}</span>
        <span class="wmeta">${icon("person")} ${o.guests} <span class="dot">·</span> ${icon("clock")} ${since(o.openedAt, now)} <span class="dot">·</span> ${mine ? `<b class="me">${t("Me")}</b>` : esc(o.waiterName ?? "—")}</span>
        ${extra}
        <span class="wtotal">${money(o.due < o.total ? o.due : o.total)}${o.due < o.total ? ` <small>${t("Due").toLowerCase()}</small>` : ""}</span>
      </button>
      ${mine || m?.canManage ? `<button class="tmore" data-act="table-menu" data-id="${tb.id}" aria-label="${t("More")} ${esc(tb.name)}">${icon("more")}</button>` : ""}
    </article>`;
}

function renderWaiting(): string {
  const empty = emptyFloor();
  if (empty) return `${topBar(t("Waiting list"))}${empty}${tabBar()}`;
  const list = waitingTables(), now = Date.now();
  const body = list.length ? WAIT_GROUPS.map((g) => {
    const rows = list.filter((x) => x.status === g.status);
    return rows.length ? `<section class="wgroup g-${STATUS[g.status].cls}"><h3>${pill(g.status)}<span>${rows.length}</span></h3>${rows.map((x) => waitCard(x, now)).join("")}</section>` : "";
  }).join("") : `<div class="empty"><span class="big-ic">${icon("clock")}</span><h2>${t("Nothing is waiting")}</h2><p>${t("Open tables show here, with food that is ready and bills on top.")}</p></div>`;
  return `${topBar(t("Waiting list"))}
    ${state.offline ? `<p class="banner">${t("Offline — showing the last known floor")}</p>` : ""}
    <div class="tools">${scopeSeg()}</div>
    <main class="floor" data-scroll="waiting">${body}</main>
    <footer class="dock">${tabBar()}</footer>`;
}

export function renderFloor(): string {
  return state.view === "waiting" ? renderWaiting() : renderTables();
}

/* ---------- one table's check ---------- */

const modsText = (l: OrderLine): string => [...l.modifiers.map((x) => x.name).filter(Boolean), l.note].filter(Boolean).join(" · ");
function draftText(d: Draft): string {
  const mods = d.mods.map((id) => state.menu?.modifiers.find((x) => x.id === id)).filter(Boolean).map((x) => nm(x!.name));
  return [...mods, d.note].filter(Boolean).join(" · ");
}
const qty = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function lineRow(l: OrderLine, editable: boolean): string {
  const sub = l.state === "VOIDED" ? l.voidReason ?? "" : modsText(l);
  return `<li class="line ${l.state === "VOIDED" ? "void" : ""}">
    <span class="q">${qty(l.quantity)}×</span>
    <span class="ln"><strong>${esc(l.name)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    <span class="lp">${money(l.total)}</span>
    ${editable && l.state !== "VOIDED" && l.state !== "SERVED" ? `<button class="icon-btn" data-act="line-remove" data-id="${l.id}" aria-label="${t("Remove")} ${esc(l.name)}">${icon(l.state === "HELD" ? "trash" : "close")}</button>` : `<span class="icon-gap"></span>`}
  </li>`;
}

/** A new item as a card: plate, name, price, note link and the +/– stepper. */
function draftCard(d: Draft, busy = false): string {
  const it = item(d.itemId);
  const sub = draftText(d);
  const name = esc(it ? nm(it.name) : d.itemId);
  return `<li class="dcard ${busy ? "busy" : ""}">
    ${plate(it)}
    <span class="dinfo">
      <strong>${name}</strong>
      <span class="dprice">${money(draftTotal(d))}</span>
      <span class="dfoot">
        ${busy ? `<small>${t("Sending…")}</small>` : `<button class="note-link" data-act="draft-edit" data-id="${d.id}">${sub ? esc(sub) : t("Add note")}</button>`}
        ${busy ? `<b class="dq">${d.qty}×</b>` : `<span class="stepper"><button data-act="draft-minus" data-id="${d.id}" aria-label="${t("Remove one {item}", { item: name })}">${icon("minus")}</button><b>${d.qty}</b><button data-act="draft-plus" data-id="${d.id}" aria-label="${t("Add one {item}", { item: name })}">${icon("plus")}</button></span>`}
      </span>
      <small class="dcourse">${t("Course {n}", { n: d.course })}</small>
    </span>
  </li>`;
}

function group(title: string, cls: string, rows: string, action = ""): string {
  return rows ? `<section class="grp ${cls}"><h3><span>${title}</span>${action}</h3><ul>${rows}</ul></section>` : "";
}

function renderCheck(o: Order, editable: boolean): string {
  const dr = draftsOf(o.id), sn = sending[o.id] ?? [];
  const by = (s: LineState[]): OrderLine[] => o.lines.filter((l) => s.includes(l.state));
  const held = by(["HELD"]);
  const courses = [...new Set(held.map((l) => l.course))].sort();
  const heldAction = !editable || !held.length ? "" : courses.length > 1
    ? courses.map((c) => `<button class="mini" data-act="fire" data-id="${c}">${icon("flame")} ${t("Send course {n}", { n: c })}</button>`).join("")
    : `<button class="mini" data-act="fire" data-id="all">${icon("flame")} ${t("Send all held")}</button>`;
  const heldRows = courses.map((c) => (courses.length > 1 ? `<li class="sub">${t("Course {n}", { n: c })}</li>` : "") + held.filter((l) => l.course === c).map((l) => lineRow(l, editable)).join("")).join("");
  const ready = by(["READY"]);
  const fresh = dr.length || sn.length
    ? `<section class="fresh"><h3>${t("New — not sent yet")}</h3><ul class="dlist">${dr.map((d) => draftCard(d)).join("")}${sn.map((d) => draftCard(d, true)).join("")}</ul></section>` : "";
  const body = fresh +
    group(t("Ready to serve"), "g-ready", ready.map((l) => lineRow(l, editable)).join(""),
      editable && ready.length ? `<button class="mini good" data-act="served">${icon("check")} ${t("Mark served")}</button>` : "") +
    group(t("Held"), "g-held", heldRows, heldAction) +
    group(t("In kitchen"), "g-kitchen", by(["SENT", "PREPARING"]).map((l) => lineRow(l, editable)).join("")) +
    group(t("Served"), "g-served", by(["SERVED"]).map((l) => lineRow(l, editable)).join("")) +
    group(t("Voided"), "g-void", by(["VOIDED"]).map((l) => lineRow(l, false)).join(""));
  if (!body) return `<div class="empty"><span class="big-ic">${icon("receipt")}</span><h2>${t("Nothing on this check yet")}</h2><p>${t("Pick dishes from the menu.")}</p>
    ${editable ? `<button class="btn" data-act="tab" data-id="menu">${t("Menu")}</button>` : ""}</div>`;
  const newTotal = dr.concat(sn).reduce((s, d) => s + draftTotal(d), 0);
  return `${o.note ? `<p class="note">${icon("note")} ${esc(o.note)}</p>` : ""}${body}
    <dl class="totals">
      ${o.vat ? `<div><dt>${t("VAT included")}</dt><dd>${money(o.vat)}</dd></div>` : ""}
      ${o.paid ? `<div><dt>${t("Paid so far")}</dt><dd>${money(o.paid)}</dd></div>` : ""}
      <div class="dashed"></div>
      <div class="grand"><dt>${o.paid ? t("Due") : t("Total")}</dt><dd>${money((o.paid ? o.due : o.total) + newTotal)}</dd></div>
    </dl>`;
}

function renderMenu(o: Order): string {
  const m = state.menu;
  if (!m) return `<div class="empty"><div class="spinner"></div><p>${t("Loading…")}</p></div>`;
  const q = state.menuSearch.trim().toLowerCase();
  const picked = new Map<string, number>();
  for (const d of draftsOf(o.id)) picked.set(d.itemId, (picked.get(d.itemId) ?? 0) + d.qty);
  const items = m.items.filter((i) => (q ? Object.values(i.name).some((n) => n.toLowerCase().includes(q)) : state.category === "ALL" || i.category === state.category) && (!state.fastingOnly || i.fasting));
  const cats = [{ code: "ALL", label: t("All") }, ...m.categories.map((c) => ({ code: c.code, label: nm(c.name) }))];
  return `
    <div class="menu-tools">
      <label class="search">${icon("search")}<input id="menuSearch" type="search" placeholder="${t("Search the menu")}" aria-label="${t("Search the menu")}" value="${esc(state.menuSearch)}" autocomplete="off"></label>
      <div class="cats" data-scroll="cats" role="group" aria-label="${t("Menu")}">
        ${cats.map((c) => `<button class="cat" data-act="cat" data-id="${c.code}" aria-pressed="${state.category === c.code && !q}"><span class="disc">${catIcon(c.code)}</span><span class="clabel">${esc(c.label)}</span></button>`).join("")}
      </div>
      <div class="course"><span>${t("New items go to course")}</span>
        ${slide([1, 2, 3].map((c) => ({ act: "course", id: String(c), label: String(c), on: state.course === c, aria: t("Course {n}", { n: c }) })), t("Course"), "small")}
        <button class="chip leaf" data-act="fasting" aria-pressed="${state.fastingOnly}">${icon("leaf")} ${t("Fasting")}</button></div>
    </div>
    <div class="items" data-scroll="items">
      ${items.length ? items.map((i) => {
        const n = picked.get(i.id) ?? 0;
        return `<button class="item ${n ? "on" : ""}" data-act="pick" data-id="${i.id}" aria-label="${esc(nm(i.name))}, ${money(i.price)}${n ? `, ${t("{n} in order", { n })}` : ""}">
          ${plate(i)}
          <span class="iname">${esc(nm(i.name))}${i.fasting ? ` <i class="leaf-dot" title="${t("Fasting")}"></i>` : ""}</span>
          <span class="iprice">${money(i.price)}</span>
          <span class="add ${n ? "has" : ""}"><span class="plus">${icon("plus")}</span>${n}</span></button>`;
      }).join("") : `<p class="none">${t("No dishes match.")}</p>`}
    </div>`;
}

export function renderOrder(): string {
  const o = order();
  if (!o) return `<header class="top order-top"><button class="icon-btn" data-act="back" aria-label="${t("Back to tables")}">${icon("back")}</button></header><main class="empty"><div class="spinner"></div></main>`;
  const open = isOpen(o), editable = open && canEdit(o);
  const dr = draftsOf(o.id);
  const count = o.lines.filter((l) => l.state !== "VOIDED").length + dr.length + (sending[o.id]?.length ?? 0);
  const tab = editable ? state.tab : "check";
  const newTotal = dr.reduce((s, d) => s + draftTotal(d), 0), newCount = dr.reduce((s, d) => s + d.qty, 0);
  let bar = "";
  if (editable && dr.length) {
    bar = tab === "menu"
      ? `<footer class="bar"><button class="cart" data-act="tab" data-id="check" aria-label="${t("Review order")}"><b>${newCount}</b>${icon("bag")}</button>
          <button class="cta grow" data-act="send" aria-label="${t("Send to kitchen")}"><span>${icon("send")} ${t("Send")}</span><span>${money(newTotal)}</span></button></footer>`
      : `<footer class="bar"><button class="btn round" data-act="hold">${icon("pause")} ${t("Hold")}</button>
          <button class="cta grow" data-act="send" aria-label="${t("Send to kitchen")}"><span>${icon("send")} ${t("Send")}</span><span>${money(newTotal)}</span></button></footer>`;
  } else if (open && tab === "check" && count) {
    const payBtn = `<button class="cta grow" data-act="pay"><span>${icon("receipt")} ${t("Take payment")}</span><span>${money(o.due)}</span></button>`;
    bar = o.billRequestedAt
      ? `<footer class="bar">${payBtn}</footer>`
      : editable ? `<footer class="bar"><button class="btn round" data-act="pay" aria-label="${t("Take payment")}">${icon("receipt")}</button><button class="cta grow" data-act="bill"><span>${icon("bell")} ${t("Request bill")}</span><span>${money(o.due)}</span></button></footer>`
      : me()?.canCash ? `<footer class="bar">${payBtn}</footer>` : "";
  }
  return `
    <header class="top order-top">
      <button class="icon-btn" data-act="back" aria-label="${t("Back to tables")}">${icon("back")}</button>
      <span class="otitle">${t("Order")}</span>
      <span class="ono">#${esc(o.orderNumber)}</span>
      ${editable ? `<button class="icon-btn" data-act="order-menu" aria-label="${t("More")}">${icon("more")}</button>` : `<span class="icon-gap wide"></span>`}
    </header>
    <div class="ochips">
      <button class="ink-chip" ${editable ? `data-act="order-menu"` : "disabled"}>${esc(tableLabel(o.tableName))} ${icon("chev")}</button>
      <button class="ink-chip" ${editable ? `data-act="om-guests"` : "disabled"} aria-label="${t("Guests")}: ${o.guests}">${icon("person")} ${o.guests}</button>
      ${pill(o.status)}
      <small class="owho">${icon("clock")} ${since(o.openedAt)} · ${o.waiterId === me()?.id ? t("Me") : esc(o.waiterName ?? "")}</small>
    </div>
    ${state.pending && state.offline ? `<p class="banner sync">${conn()}</p>` : ""}
    ${!open ? `<p class="banner">${t("This check is closed.")}</p>` : !editable ? `<p class="banner info">${t("This table belongs to {name}. You can look, but only they or a manager can change it.", { name: o.waiterName ?? "—" })}</p>` : ""}
    ${editable ? `<div class="tools tight">${slide([
      { act: "tab", id: "menu", label: t("Menu"), on: tab === "menu" },
      { act: "tab", id: "check", label: `${t("Check")}${count ? ` <b>${count}</b>` : ""}`, on: tab === "check" },
    ], t("Order"))}</div>` : ""}
    <main class="order ${tab}" data-scroll="order-${tab}">${tab === "menu" ? renderMenu(o) : renderCheck(o, editable)}</main>
    ${bar}`;
}

/* ---------- sheets ---------- */

const sheet = (title: string, body: string, cls = ""): string => `
  <div class="backdrop" data-act="sheet-close"></div>
  <section class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-act="sheet-close" aria-label="${t("Cancel")}">${icon("close")}</button></header>
    ${body}
  </section>`;

const VOID_REASONS = ["Guest changed their mind", "Entered by mistake", "Kitchen is out of it", "Took too long"];
const METHODS: { id: PayMethod; label: string }[] = [{ id: "TELEBIRR", label: "Telebirr" }, { id: "CBE_BIRR", label: "CBE Birr" }, { id: "CASH", label: "Cash" }];

export function renderSheet(): string {
  const s = state.sheet;
  if (!s) return "";
  const o = order();
  switch (s.kind) {
    case "guests": {
      const tb = tableOf(s.tableId);
      return sheet(s.orderId ? t("Change guests") : t("Open {table}", { table: tableLabel(tb?.name ?? "") }), `
        <p class="q-label">${t("How many guests?")}</p>
        <div class="num-grid">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="num ${s.guests === n ? "on" : ""}" data-act="guests-set" data-id="${n}">${n}</button>`).join("")}</div>
        <div class="stepper-row"><span>${t("Guests")}</span><span class="step big"><button data-act="guests-step" data-id="-1" aria-label="−">${icon("minus")}</button><b>${s.guests}</b><button data-act="guests-step" data-id="1" aria-label="+">${icon("plus")}</button></span></div>
        <button class="btn primary big" data-act="guests-ok">${s.orderId ? t("Save") : t("Open table")}</button>`);
    }
    case "item": {
      const d = draftsOf(state.orderId).find((x) => x.id === s.draftId);
      const it = d && item(d.itemId);
      if (!d || !it) return "";
      const mods = (state.menu?.modifiers ?? []).filter((m) => !it.modifiers || it.modifiers.includes(m.id));
      return sheet(nm(it.name), `
        <div class="stepper-row"><span>${t("Quantity")}</span><span class="step big"><button data-act="draft-minus" data-id="${d.id}" aria-label="−">${icon("minus")}</button><b>${d.qty}</b><button data-act="draft-plus" data-id="${d.id}" aria-label="+">${icon("plus")}</button></span></div>
        <div class="seg wide">${[1, 2, 3].map((c) => `<button data-act="draft-course" data-id="${c}" aria-pressed="${d.course === c}">${t("Course {n}", { n: c })}</button>`).join("")}</div>
        ${mods.length ? `<p class="q-label">${t("Options")}</p><div class="chips wrap">${mods.map((m) => `<button class="chip" data-act="draft-mod" data-id="${m.id}" aria-pressed="${d.mods.includes(m.id)}">${esc(nm(m.name))}${m.priceDelta ? ` +${m.priceDelta}` : ""}</button>`).join("")}</div>` : ""}
        <label class="field"><span>${t("Note for the kitchen")}</span><input id="draftNote" value="${esc(d.note)}" placeholder="${t("e.g. no salt, well done")}" maxlength="120" autocomplete="off"></label>
        <div class="row"><button class="btn danger" data-act="draft-remove" data-id="${d.id}">${icon("trash")} ${t("Remove")}</button><button class="btn primary grow" data-act="draft-done">${t("Done")}</button></div>`);
    }
    case "send": {
      const cs = [...new Set(draftsOf(state.orderId).map((d) => d.course))].sort();
      return sheet(t("Send to kitchen"), `
        <button class="opt primary" data-act="send-all">${icon("send")} ${t("Send everything now")}</button>
        <button class="opt" data-act="send-first" data-id="${cs[0]}">${icon("flame")} ${t("Send course {n} now, hold the rest", { n: cs[0] })}</button>
        <button class="opt" data-act="hold">${icon("pause")} ${t("Hold everything")}</button>
        <p class="hint">${t("Held items stay on the check and go to the kitchen when you send them.")}</p>`);
    }
    case "void": {
      const l = o?.lines.find((x) => x.id === s.lineId);
      if (!l) return "";
      return sheet(t("Void {item}?", { item: l.name }), `
        <p class="hint">${t("The kitchen already has this item. Say why it is being voided — your manager sees this.")}</p>
        <div class="opts">${VOID_REASONS.map((r) => `<button class="opt ${s.reason === r ? "on" : ""}" data-act="void-reason" data-id="${esc(r)}">${t(r)}</button>`).join("")}</div>
        <label class="field"><span>${t("Other reason")}</span><input id="voidOther" value="${esc(s.other)}" maxlength="120" autocomplete="off"></label>
        <button class="btn danger big" data-act="void-ok">${t("Void item")}</button>`);
    }
    case "transfer": {
      const cur = orders_waiter(s.orderId);
      const list = (state.floor?.waiters ?? []).filter((w) => w.id !== cur);
      return sheet(t("Who takes this table?"), `<div class="opts">${list.map((w) => `<button class="opt" data-act="transfer-to" data-id="${w.id}"><span class="avatar sm">${esc(initials(w.name))}</span> ${esc(w.name)}${w.id === me()?.id ? ` (${t("Me")})` : ""}</button>`).join("")}</div>`);
    }
    case "move": {
      const free = (state.floor?.tables ?? []).filter((x) => x.status === "FREE");
      return sheet(t("Which table?"), free.length ? `<div class="num-grid">${free.map((x) => `<button class="num" data-act="move-to" data-id="${x.id}">${esc(x.name)}</button>`).join("")}</div>` : `<p class="hint">${t("No free tables.")}</p>`);
    }
    case "note":
      return sheet(t("Note for this table"), `
        <label class="field"><span class="sr">${t("Note for this table")}</span><input id="tableNote" value="${esc(o?.note ?? "")}" placeholder="${t("e.g. birthday, allergy, in a hurry")}" maxlength="200" autocomplete="off"></label>
        <button class="btn primary big" data-act="note-ok">${t("Save")}</button>`);
    case "pay": {
      const po = orders_get(s.orderId);
      if (!po) return "";
      const cash = !!me()?.canCash;
      return sheet(t("Payment for {table}", { table: tableLabel(po.tableName) }), `
        <p class="due"><span>${t("Due")}</span><strong>${money(po.due)}</strong></p>
        <div class="seg wide">${METHODS.filter((m) => cash || m.id !== "CASH").map((m) => `<button data-act="pay-method" data-id="${m.id}" aria-pressed="${s.method === m.id}">${t(m.label)}</button>`).join("")}</div>
        <label class="field"><span>${t("Amount")}</span><input id="payAmount" inputmode="decimal" value="${esc(s.amount)}" autocomplete="off"></label>
        ${s.method !== "CASH" ? `<label class="field"><span>${t("Transaction ID")}</span><input id="payRef" value="${esc(s.reference)}" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>` : ""}
        <p class="err" role="alert">${esc(s.error)}</p>
        <button class="btn primary big" data-act="pay-ok">${t("Confirm payment")}</button>
        ${cash ? "" : `<p class="hint">${t("Cash is paid at the cashier. Request the bill and the cashier takes it from there.")}</p>`}`);
    }
    case "table": {
      const tb = tableOf(s.tableId);
      if (!tb?.order) return "";
      return sheet(tableLabel(tb.name), `<div class="opts">
        ${tb.status !== "BILL" ? `<button class="opt" data-act="tm-bill" data-id="${tb.id}">${icon("bell")} ${t("Request bill")}</button>` : ""}
        <button class="opt" data-act="tm-transfer" data-id="${tb.id}">${icon("swap")} ${t("Transfer to another waiter")}</button>
        <button class="opt" data-act="tm-move" data-id="${tb.id}">${icon("table")} ${t("Move to another table")}</button></div>`);
    }
    case "orderMenu":
      return sheet(tableLabel(o?.tableName ?? ""), `<div class="opts">
        ${o?.billRequestedAt ? `<button class="opt" data-act="bill-off">${icon("bell")} ${t("Not ready for bill")}</button>` : ""}
        <button class="opt" data-act="om-guests">${icon("people")} ${t("Change guests")}</button>
        <button class="opt" data-act="om-note">${icon("note")} ${t("Note for this table")}</button>
        <button class="opt" data-act="om-transfer">${icon("swap")} ${t("Transfer to another waiter")}</button>
        <button class="opt" data-act="om-move">${icon("table")} ${t("Move to another table")}</button>
        ${o && !o.lines.some((l) => l.state !== "VOIDED") && !o.paid ? `<button class="opt danger" data-act="om-close">${icon("close")} ${t("Close table (nothing ordered)")}</button>` : ""}</div>`);
    case "profile": {
      const u = sessionUser();
      return sheet(u?.name ?? "", `
        <div class="stepper-row"><span>${t("Language")}</span><div class="seg">${LANGS.map((l) => `<button data-act="lang" data-id="${l.code}" aria-pressed="${state.lang === l.code}">${l.label}</button>`).join("")}</div></div>
        <div class="stepper-row"><span>${t("Dark mode")}</span><button class="switch" data-act="dark" role="switch" aria-checked="${state.dark}"><i></i></button></div>
        ${state.branches.length > 1 ? `<label class="field"><span>${t("Branch")}</span><select id="branchSel">${state.branches.map((b) => `<option value="${b.id}" ${b.id === u?.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>` : ""}
        <div class="opts">${me()?.canSetup ? `<button class="opt" data-act="setup">${icon("table")} ${t("Manage tables")}</button>` : ""}
        <button class="opt danger" data-act="sign-out">${icon("out")} ${t("Sign out")}</button></div>`);
    }
    case "setup": {
      const tables = state.floor?.tables ?? [];
      if (!tables.length) return sheet(t("Set up tables"), `
        <label class="field"><span>${t("How many tables does this branch have?")}</span><input id="setupCount" inputmode="numeric" value="${esc(s.count)}" autocomplete="off"></label>
        <p class="hint">${t("They are named T1, T2, … You can rename or remove them later.")}</p>
        <p class="err" role="alert">${esc(s.error)}</p>
        <button class="btn primary big" data-act="setup-create" ${s.busy ? "disabled" : ""}>${t("Create tables")}</button>`);
      return sheet(t("Manage tables"), `
        <ul class="tlist">${tables.map((x) => `<li><strong>${esc(x.name)}</strong><span>${pill(x.status)}</span>
          <button class="icon-btn" data-act="setup-rename" data-id="${x.id}" aria-label="${t("Rename")} ${esc(x.name)}">${icon("note")}</button>
          <button class="icon-btn" data-act="setup-remove" data-id="${x.id}" ${x.status === "FREE" ? "" : "disabled"} aria-label="${t("Remove table")} ${esc(x.name)}">${icon("trash")}</button></li>`).join("")}</ul>
        <div class="row"><label class="field grow"><span>${t("Add a table")}</span><input id="setupName" value="${esc(s.name)}" placeholder="${t("Table name")}" maxlength="20" autocomplete="off"></label>
          <button class="btn primary" data-act="setup-add" ${s.busy ? "disabled" : ""}>${t("Add")}</button></div>
        <p class="err" role="alert">${esc(s.error)}</p>`, "tall");
    }
  }
}

const orders_get = (id: string): Order | undefined => orders[id];
const orders_waiter = (id: string): string | null => orders[id]?.waiterId ?? state.floor?.tables.find((x) => x.order?.id === id)?.order?.waiterId ?? null;

export function renderApp(): string {
  if (!isConfigured) return `<main class="empty"><h2>${t("This app needs the backend address.")}</h2><p><code>VITE_API_URL</code></p></main>`;
  if (!sessionUser()) return renderSignIn();
  return `<div class="screen">${state.orderId ? renderOrder() : renderFloor()}</div>${renderSheet()}
    ${state.toast ? `<div class="toast ${state.toast.bad ? "bad" : ""}" role="status">${esc(state.toast.text)}</div>` : ""}`;
}
